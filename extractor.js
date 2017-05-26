'use strict';

const xpath = require('xpath-stream');

const util = require('util');

const PassThrough = require('stream').PassThrough;

const StreamCombiner = function(input,output) {
  this.output = output;
  this.on('pipe', function(source) {
    console.log("Redirecting input pipe");
    source.unpipe(this);
    source.pipe(input);
  });
};

util.inherits(StreamCombiner, PassThrough);

StreamCombiner.prototype.pipe = function(dest, options) {
  console.log("Redirecting output");
  return this.output.pipe(dest, options);
};

const fs = require('fs');

const restrictions = [
  'http://www.obofoundry.org/ro/ro.owl#derives_from',
  'http://purl.org/obo/owl/OBO_REL#bearer_of',
  'http://www.ebi.ac.uk/efo/EFO_0000784'
];

//  'derives_from' : './rdfs:subClassOf/owl:Restriction[ owl:onProperty/@rdf:resource = \'http://www.obofoundry.org/ro/ro.owl#derives_from\' ]//rdf:Description[starts-with(@rdf:about,\'http://purl.obolibrary.org/obo/UBERON_\')]/@rdf:about',


const efo_template = {
  'id' : './@rdf:about',
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

fs.createReadStream('/tmp/efo.owl').pipe(stream_reader()).pipe(new PassThrough({objectMode: true})).on('data', datas => {
  datas = datas.filter( dat => {
    if (dat.bearer_of && ! dat.derives_from && ! dat.located_in && ! dat.located_in_2 ) {
      return true;
    }
  });
  console.dir(datas);
});


// cat /tmp/efo.owl | node_modules/.bin/xpath-stream --namespace=owl:http://www.w3.org/2002/07/owl# --namespace=rdfs:http://www.w3.org/2000/01/rdf-schema# --namespace=rdf:http://www.w3.org/1999/02/22-rdf-syntax-ns#  "//owl:Class[rdfs:subClassOf/owl:Restriction/owl:onProperty/@rdf:resource= 'http://www.obofoundry.org/ro/ro.owl#derives_from']/rdfs:label/text()"

// cat /tmp/efo.owl | node_modules/.bin/xpath-stream --namespace=owl:http://www.w3.org/2002/07/owl# --namespace=rdfs:http://www.w3.org/2000/01/rdf-schema# --namespace=rdf:http://www.w3.org/1999/02/22-rdf-syntax-ns#  "//owl:Class[rdfs:subClassOf/owl:Restriction/owl:onProperty/@rdf:resource= 'http://purl.org/obo/owl/OBO_REL#bearer_of']/rdfs:label/text()"

// cat /tmp/efo.owl | node_modules/.bin/xpath-stream --namespace=owl:http://www.w3.org/2002/07/owl# --namespace=rdfs:http://www.w3.org/2000/01/rdf-schema# --namespace=rdf:http://www.w3.org/1999/02/22-rdf-syntax-ns#  "//owl:Class[rdfs:subClassOf/owl:Restriction/owl:onProperty/@rdf:resource= 'http://www.ebi.ac.uk/efo/EFO_0000784']/rdfs:label/text()"