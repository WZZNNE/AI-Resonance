/** One XML parser configuration for every feed we read (arXiv Atom, journal RSS / Atom / RDF). */
import { XMLParser } from 'fast-xml-parser'

/** A parsed element: text-only elements are strings, anything with attributes or children is an object. */
export type XmlNode = string | { [name: string]: XmlNode | XmlNode[] | undefined }

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // Titles like "2048" and ids like "2609.10000" must stay strings.
  parseTagValue: false,
  parseAttributeValue: false,
  htmlEntities: true,
})

/** Parses a document; throws on anything that is not XML at all (an HTML block page, an empty body). */
export function parseXml(xml: string): Record<string, XmlNode | undefined> {
  if (!xml.trimStart().startsWith('<')) throw new Error(`not XML: ${xml.slice(0, 60) || '(empty body)'}`)
  return parser.parse(xml)
}

/** Repeated elements parse to an array, single ones to a value: normalise to an array. */
export function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

/** Text content of an element whether or not it carried attributes (`<title type="html">…`). */
export function textOf(node: XmlNode | XmlNode[] | undefined): string {
  const first = Array.isArray(node) ? node[0] : node
  if (typeof first === 'string') return first
  const text = first?.['#text']
  return typeof text === 'string' ? text : ''
}

/** Child element(s) `name` of an element; `undefined` for text nodes and missing children. */
export function childOf(node: XmlNode | XmlNode[] | undefined, name: string): XmlNode | XmlNode[] | undefined {
  const first = Array.isArray(node) ? node[0] : node
  return typeof first === 'object' ? first[name] : undefined
}

/** Attribute value of an element, `''` when absent. */
export function attrOf(node: XmlNode | undefined, name: string): string {
  const value = typeof node === 'object' ? node[`@_${name}`] : undefined
  return typeof value === 'string' ? value : ''
}
