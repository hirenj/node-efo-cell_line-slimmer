'use strict';

const xpath = require('xpath-stream');
const zlib = require('zlib');

const util = require('util');
const path = require('path');

const PassThrough = require('stream').PassThrough;

const converter = require('node-uberon-mappings');

const StreamCombiner = function(input,output) {
  this.output = output;
  this.on('pipe', function(source) {
    source.unpipe(this);
    source.pipe(input);
  });
};

util.inherits(StreamCombiner, PassThrough);

StreamCombiner.prototype.pipe = function(dest, options) {
  return this.output.pipe(dest, options);
};

const fs = require('fs');

const restrictions = [
  'http://www.obofoundry.org/ro/ro.owl#derives_from',
  'http://purl.org/obo/owl/OBO_REL#bearer_of',
  'http://www.ebi.ac.uk/efo/EFO_0000784'
];

const efo_template = {
  'id' : './@rdf:about',
  'parent' : './rdfs:subClassOf[@rdf:resource]/@rdf:resource',
  'label' : './rdfs:label/text()',
  'bto_mapping' : './efo:BTO_definition_citation/text()',
  'derives_from' : './rdfs:subClassOf/owl:Restriction[ owl:onProperty/@rdf:resource = \'http://www.obofoundry.org/ro/ro.owl#derives_from\' ]//rdf:Description/@rdf:about',
  'bearer_of' : './rdfs:subClassOf/owl:Restriction[ owl:onProperty/@rdf:resource = \'http://purl.org/obo/owl/OBO_REL#bearer_of\' ]/owl:someValuesFrom/@rdf:resource',
  'located_in' : './rdfs:subClassOf/owl:Restriction[ owl:onProperty/@rdf:resource = \'http://www.ebi.ac.uk/efo/EFO_0000784\' ]/owl:someValuesFrom/@rdf:resource',
  'located_in_2' : './rdfs:subClassOf/owl:Restriction[ owl:onProperty/@rdf:resource = \'http://www.ebi.ac.uk/efo/EFO_0000784\' ]/owl:someValuesFrom//rdf:Description/@rdf:about'
};

const restriction_path = 'rdfs:subClassOf/owl:Restriction/owl:onProperty/@rdf:resource';

const stream_reader = function() {
  let result = new PassThrough({objectMode: true});
  let input = new PassThrough();
  let namespaces = {
    'owl' : 'http://www.w3.org/2002/07/owl#',
    'rdfs' : 'http://www.w3.org/2000/01/rdf-schema#',
    'rdf' : 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
    'efo' : 'http://www.ebi.ac.uk/efo/'
  };
  let parsers = restrictions.map( axis => {
    return xpath(`//owl:Class[ ${restriction_path} = '${axis}' ]`,efo_template,namespaces);
  });
  let parsers_finished = Promise.all(parsers.map( parser => {
    input.pipe(parser);
    parser.pipe(result,{end: false});
    return new Promise(resolve => {
      parser.on('end',resolve);
    });
  }));
  parsers_finished.then( () => result.end() );
  return (new StreamCombiner(input,result));
};

const read_efo_data = function(input) {
  let instream = input;
  if (typeof input === 'string') {
    instream = fs.createReadStream(input).pipe(zlib.createGunzip());
  }
  let efo_stream = instream.pipe(stream_reader()).pipe(new PassThrough({objectMode: true}));
  return efo_stream;
};

const read_efo_table = function(input) {
  let efo_cache = {};
  let efo_stream = read_efo_data(input);
  efo_stream.on('data', datas => datas.forEach( efo => {
    let short_id = efo.id.replace(/^.*\//,'').replace('_',':');
    efo_cache[short_id] = efo;
    efo_cache[efo.id] = efo;
  }));
  return new Promise( resolve => efo_stream.on('end', () => resolve(efo_cache) ) );
};

const find_parent = function(input,cache) {
  if ( ! input ) {
    return;
  }
  let current = cache[input];
  if (current && ! (current.derives_from || current.located_in || current.located_in_2 )) {
    return find_parent(current.parent);
  }
  return current.id;
};

console.error("Reading EFO table");

let table_promise = Promise.resolve()
                    .then( () => read_efo_table(path.join(__dirname,'efo.owl.gz')) )
                    .then( cache => { console.error("Finished reading EFO table"); return cache; });

const convert_id = function(cache,id) {
  let efo = cache[id];
  let target_efo = efo;
  if ( ! efo ) {
    console.log("Missing EFO id for ",id);
    return Promise.resolve({ unmapped: true, efo_label: "", efo_id: id });
  }
  if ( efo.bearer_of && ! (efo.derives_from || efo.located_in || efo.located_in_2 ) ) {
    if ( ! cache[efo.bearer_of] ) {
      // Maybe ignore this for the moment.. few entries like this
      // console.log(efo.label, efo.bearer_of, cache[efo.bearer_of]);
    } else {
      target_efo = cache[efo.bearer_of];
    }
  }
  let mapped = target_efo.derives_from || target_efo.located_in || target_efo.located_in_2 || [];

  if (efo.bto_mapping && mapped.filter( entry => entry.indexOf('UBERON') >= 0 ).length < 1) {
    mapped = efo.bto_mapping;
  }
  mapped = [].concat(mapped)
          .filter( entry => (entry.indexOf('UBERON') >= 0) || (entry.indexOf('BTO') >= 0) )
          .map( entry => entry.replace(/^.*\//,'').replace('_',':') );

  if ( mapped.length < 1 ) {
    return Promise.resolve({ unmapped: true, efo_label: efo.label, efo_id: id });
  }
  return converter.convert(mapped[0]).then( new_root => {
    new_root.efo_label = efo.label;
    new_root.efo_id = id;
    return new_root;
  });
};

const show_all_mappings = function() {
  table_promise.then( cache => {
    let efo_ids = Object.keys(cache).filter( id => id.indexOf('EFO') == 0);
    efo_ids.map( id => {
      convert_id(cache,id).then( mapped => {
        console.log(id,mapped);
      });
    });
  });
};

exports.print_mappings = show_all_mappings;
exports.convert = id => table_promise.then( cache => convert_id(cache,id) );

if (!module.parent) {
  show_all_mappings();
}
