/**
 * Shared YAML reading for the test suite.
 *
 * The harness's loader dialect carries `!!js` expression nodes (a `!!js expr`
 * scalar becomes `{ __jsExpr: expr }`). The composition and the bundle patch are
 * parsed here with the same shape, so a test can assert on a row's gate without
 * running a Loader.
 * @module test/yaml
 */
import yaml from 'js-yaml';

/** The `!!js` tag (`!!name` is shorthand for the `tag:yaml.org,2002:name` URI). */
const JS_TAG = 'tag:yaml.org,2002:js';

const jsType = new yaml.Type(JS_TAG, {
  kind: 'scalar',
  construct: (data) => ({ __jsExpr: String(data) }),
  // A `!!js` node is a map in our assertions, never a string in the source.
  predicate: (data) => typeof data === 'string',
});

/** Schema accepting the loader's `!!js` nodes. */
const schema = yaml.DEFAULT_SCHEMA.extend({ explicit: [jsType] });

/**
 * Parse one YAML document in the loader dialect.
 * @param text - the file contents.
 * @returns the parsed document.
 */
export function loadYaml(text) {
  return yaml.load(text, { schema });
}

/** Whether a value is a `!!js` expression node. */
export function isJsExpr(value) {
  return value !== null && typeof value === 'object' && typeof value.__jsExpr === 'string';
}
