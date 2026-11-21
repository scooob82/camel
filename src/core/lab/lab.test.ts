import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jsonToXml, jsonToXpathXml, samplePaths, xmlToJson } from './convert';
import { csvToMapping, mappingToCsv, mappingToXslt, xsltToMapping, type MappingRow } from './mapping';
import { diffSchemas, impactOf, parseXsd, sampleJson, sampleXml } from './xsd';

const XSD_V1 = `<?xml version="1.0"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="order" type="OrderType"/>
  <xs:complexType name="OrderType">
    <xs:sequence>
      <xs:element name="id" type="xs:string"/>
      <xs:element name="status" type="StatusType"/>
      <xs:element name="customer">
        <xs:complexType>
          <xs:sequence>
            <xs:element name="name" type="xs:string"/>
            <xs:element name="fax" type="xs:string" minOccurs="0"/>
          </xs:sequence>
        </xs:complexType>
      </xs:element>
      <xs:element name="line" maxOccurs="unbounded">
        <xs:complexType>
          <xs:sequence>
            <xs:element name="sku" type="xs:string"/>
            <xs:element name="qty" type="xs:int"/>
          </xs:sequence>
          <xs:attribute name="no" type="xs:int" use="required"/>
        </xs:complexType>
      </xs:element>
    </xs:sequence>
    <xs:attribute name="currency" type="xs:string"/>
  </xs:complexType>
  <xs:simpleType name="StatusType">
    <xs:restriction base="xs:string">
      <xs:enumeration value="NEW"/>
      <xs:enumeration value="PAID"/>
      <xs:enumeration value="CANCELLED"/>
    </xs:restriction>
  </xs:simpleType>
</xs:schema>`;

const XSD_V2 = XSD_V1.replace('<xs:element name="fax" type="xs:string" minOccurs="0"/>', '<xs:element name="email" type="xs:string"/>')
  .replace('name="qty" type="xs:int"', 'name="qty" type="xs:decimal"')
  .replace('<xs:enumeration value="CANCELLED"/>', '<xs:enumeration value="SHIPPED"/>');

test('parse XSD into paths', () => {
  const { roots, nodes } = parseXsd(XSD_V1);
  assert.deepEqual(roots, ['order']);
  const paths = nodes.map((n) => n.path);
  for (const p of ['order', 'order/id', 'order/customer/fax', 'order/line/qty', 'order/line/@no', 'order/@currency']) assert.ok(paths.includes(p), p);
  const line = nodes.find((n) => n.path === 'order/line')!;
  assert.equal(line.maxOccurs, -1);
  assert.deepEqual(nodes.find((n) => n.path === 'order/status')!.enumeration, ['NEW', 'PAID', 'CANCELLED']);
});

test('diff XSD versions and find impact', () => {
  const changes = diffSchemas(XSD_V1, XSD_V2);
  const by = (p: string, k: string) => changes.find((c) => c.path === p && c.kind === k);
  assert.ok(by('order/customer/fax', 'removed')?.breaking);
  assert.ok(by('order/customer/email', 'added')?.breaking, 'required element added is breaking');
  assert.equal(by('order/line/qty', 'type')?.to, 'decimal');
  assert.match(by('order/status', 'enumeration')!.message, /removed: CANCELLED/);
  const xslt = `<xsl:template match="/">\n  <Fax><xsl:value-of select="order/customer/fax"/></Fax>\n  <Qty><xsl:value-of select="order/line/qty"/></Qty>\n</xsl:template>`;
  const impact = impactOf(changes, [{ name: 'order.xsl', text: xslt }]);
  assert.deepEqual(impact.map((i) => `${i.path}:${i.line}`).sort(), ['order/customer/fax:2', 'order/line/qty:3']);
});

test('sample XML from XSD and sample JSON from JSON Schema', () => {
  const xml = sampleXml(XSD_V1, { repeat: 2 });
  assert.match(xml, /<order currency="currency">/);
  assert.equal((xml.match(/<line no="/g) ?? []).length, 2);
  assert.match(xml, /<status>NEW<\/status>/);
  assert.match(xml, /<qty>42<\/qty>/);
  const required = sampleXml(XSD_V1, { optional: false });
  assert.doesNotMatch(required, /fax|currency/);
  const json = sampleJson({ type: 'object', required: ['id'], properties: { id: { type: 'integer' }, email: { type: 'string', format: 'email' }, tags: { type: 'array', items: { type: 'string', enum: ['a', 'b'] } } } });
  assert.deepEqual(json, { id: 1, email: 'user@example.com', tags: ['a'] });
});

test('JSON ⇄ XML', () => {
  const xml = jsonToXml({ order: { '@id': 'A1', line: [{ sku: 'X', qty: 2 }, { sku: 'Y', qty: 1 }], note: null } });
  assert.match(xml, /<order id="A1">/);
  assert.equal((xml.match(/<line>/g) ?? []).length, 2);
  assert.deepEqual(xmlToJson(xml, { typed: true }), { order: { '@id': 'A1', line: [{ sku: 'X', qty: 2 }, { sku: 'Y', qty: 1 }], note: null } });
  assert.match(jsonToXpathXml({ a: [1, true, 'x'] }), /<map xmlns="http:\/\/www.w3.org\/2005\/xpath-functions">\n  <array key="a">\n    <number>1<\/number>/);
  const paths = samplePaths('{"order":{"id":"A1","line":[{"qty":1}]}}').map((p) => `${p.path}${p.repeated ? '[]' : ''}`);
  assert.deepEqual(paths, ['order', 'order/id', 'order/line[]', 'order/line/qty']);
});

const ROWS: MappingRow[] = [
  { target: 'Invoice/@currency', source: 'EUR', rule: 'constant' },
  { target: 'Invoice/Number', source: 'order/id', rule: 'copy' },
  { target: 'Invoice/Customer', source: "concat(order/customer/name, ' (', order/id, ')')", rule: 'xpath' },
  { target: 'Invoice/Lines/Line', source: 'order/line', rule: 'loop' },
  { target: 'Invoice/Lines/Line/@no', source: '@no', rule: 'copy' },
  { target: 'Invoice/Lines/Line/Code', source: 'sku', rule: 'copy' },
  { target: 'Invoice/Lines/Line/Quantity', source: 'qty', rule: 'copy' },
];

test('mapping → XSLT → mapping round-trip', () => {
  const xslt = mappingToXslt(ROWS);
  assert.match(xslt, /<Invoice currency="EUR">/);
  assert.match(xslt, /<xsl:for-each select="order\/line">\n\s+<Line>\n\s+<xsl:attribute name="no"><xsl:value-of select="@no"\/><\/xsl:attribute>/);
  assert.match(xslt, /<Code><xsl:value-of select="sku"\/><\/Code>/);
  const back = xsltToMapping(xslt);
  assert.deepEqual(back, ROWS);
});

test('mapping CSV (Excel) round-trip incl. Czech headers', () => {
  const csv = mappingToCsv(ROWS);
  assert.match(csv, /^target;source;rule;note\r\n/);
  assert.deepEqual(csvToMapping(csv), ROWS);
  const cz = 'Cíl;Zdroj;Pravidlo;Poznámka\nFaktura/Cislo;order/id;copy;\nFaktura/@mena;CZK;konstanta;pevná měna\n';
  assert.deepEqual(csvToMapping(cz), [
    { target: 'Faktura/Cislo', source: 'order/id', rule: 'copy' },
    { target: 'Faktura/@mena', source: 'CZK', rule: 'constant', note: 'pevná měna' },
  ]);
});

test('anonymous root types and recursive named types', () => {
  const one = `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="order"><xs:complexType><xs:sequence><xs:element name="id" type="xs:string"/><xs:element name="fax" type="xs:string" minOccurs="0"/></xs:sequence></xs:complexType></xs:element></xs:schema>`;
  assert.deepEqual(parseXsd(one).nodes.map((n) => n.path), ['order', 'order/id', 'order/fax']);
  const two = one.replace('<xs:element name="fax" type="xs:string" minOccurs="0"/>', '<xs:element name="email" type="xs:string"/>');
  assert.deepEqual(diffSchemas(one, two).map((c) => `${c.kind}:${c.path}`), ['added:order/email', 'removed:order/fax']);
  const rec = `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="node" type="T"/><xs:complexType name="T"><xs:sequence><xs:element name="child" type="T" minOccurs="0"/></xs:sequence></xs:complexType></xs:schema>`;
  assert.deepEqual(parseXsd(rec).nodes.map((n) => n.path), ['node', 'node/child']);
});
