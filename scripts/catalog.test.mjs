// Test the camel-catalog generator against a fixture jar in the official JSON format.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import JSZip from 'jszip';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { category, readCatalog, toComponentDef } from './generate-catalog.mjs';

const kafka = {
  component: { kind: 'component', name: 'kafka', scheme: 'kafka', title: 'Kafka', description: 'Send and receive messages to/from an Apache Kafka broker.', label: 'messaging', syntax: 'kafka:topic', consumerOnly: false, producerOnly: false, deprecated: false, artifactId: 'camel-kafka' },
  properties: {
    topic: { index: 0, kind: 'path', displayName: 'Topic', group: 'common', required: true, description: 'Name of the topic to use.' },
    brokers: { index: 1, kind: 'parameter', group: 'common', description: 'URL of the Kafka brokers to use. The format is host1:port1.' },
    autoOffsetReset: { index: 2, kind: 'parameter', group: 'consumer', defaultValue: 'latest', enum: ['latest', 'earliest', 'none'], description: 'What to do when there is no initial offset.' },
    shutdownTimeout: { index: 3, kind: 'parameter', group: 'common', label: 'common,advanced', description: 'Advanced thing.' },
    oldThing: { index: 4, kind: 'parameter', group: 'common', deprecated: true, description: 'Old.' },
  },
};
const timer = { component: { kind: 'component', name: 'timer', scheme: 'timer', title: 'Timer', description: 'Generate messages in specified intervals.', label: 'core,scheduling', syntax: 'timer:timerName', consumerOnly: true, producerOnly: false, deprecated: false, artifactId: 'camel-timer' }, properties: {} };
const old = { component: { ...timer.component, name: 'old', scheme: 'old', deprecated: true }, properties: {} };

test('maps a camel-catalog component', () => {
  const d = toComponentDef(kafka);
  assert.equal(d.scheme, 'kafka');
  assert.equal(d.category, 'Messaging');
  assert.equal(d.starter, 'camel-kafka-starter');
  assert.deepEqual(d.options.map((o) => o.name), ['brokers', 'autoOffsetReset']);
  assert.equal(d.options[0].description, 'URL of the Kafka brokers to use');
  assert.deepEqual(d.options[1].enum, ['latest', 'earliest', 'none']);
  assert.equal(toComponentDef(timer).producer, false);
  assert.equal(toComponentDef(old), undefined);
  assert.equal(category('core,scheduling'), 'Scheduling');
});

test('reads components from a jar', async () => {
  const z = new JSZip();
  for (const c of [kafka, timer, old]) z.file(`org/apache/camel/catalog/components/${c.component.name}.json`, JSON.stringify(c));
  z.file('org/apache/camel/catalog/dataformats/json.json', '{}');
  const dir = mkdtempSync(join(tmpdir(), 'cat-'));
  const jar = join(dir, 'camel-catalog.jar');
  writeFileSync(jar, await z.generateAsync({ type: 'nodebuffer' }));
  const defs = await readCatalog(jar);
  assert.deepEqual(defs.map((d) => d.scheme), ['kafka', 'timer']);
});
