'use strict';

const xpath = require('xpath-stream');

const util = require('util');

const PassThrough = require('stream').PassThrough;

const StreamCombiner = function(input,output) {
  this.output = output;
  this.on('pipe', function(source) {
    source.unpipe(this);
    source.pipe(input);
  });
  this.on('end', () => console.log("Ended combiner"));
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
    'rdf' : 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
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
    instream = fs.createReadStream(input);
  }
  let efo_stream = instream.pipe(stream_reader()).pipe(new PassThrough({objectMode: true}));
  return efo_stream;
};

const read_efo_table = function(input) {
  let efo_cache = {};
  let efo_stream = read_efo_data(input);
  efo_stream.on('data', datas => datas.forEach( efo => efo_cache[efo.id] = efo ));
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

read_efo_table('/tmp/efo.owl').then( cache => {
  let efo_ids = Object.keys(cache).filter( id => id.indexOf('EFO') >= 0);
  efo_ids.forEach( id => {
    let efo = cache[id];
    let target_efo = efo;
    if ( efo.bearer_of && ! (efo.derives_from || efo.located_in || efo.located_in_2 ) ) {
      if ( ! cache[efo.bearer_of] ) {
        // Maybe ignore this for the moment.. few entries like this
        // console.log(efo.label, efo.bearer_of, cache[efo.bearer_of]);
      } else {
        target_efo = cache[efo.bearer_of];
      }
    }
    console.log(efo.label,target_efo.derives_from || target_efo.located_in || target_efo.located_in_2);
  });
});