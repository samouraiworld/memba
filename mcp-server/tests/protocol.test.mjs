import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

// Exercise the compiled server through its actual MCP transport: upgrading Zod
// must preserve tool JSON schemas, defaults and validation before RPC dispatch.
test('MCP tools preserve schemas, defaults and invalid-input errors with Zod 4', { timeout: 15_000 }, async t => {
  const requests = []
  const rpc = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    requests.push(body)
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({
      jsonrpc: '2.0', id: body.id,
      result: { response: { ResponseBase: { Data: Buffer.from('Fixture DAO').toString('base64') } } },
    }))
  })
  rpc.listen(0, '127.0.0.1')
  await once(rpc, 'listening')
  t.after(() => new Promise(resolve => rpc.close(resolve)))

  const client = new Client({ name: 'memba-schema-regression', version: '1.0.0' })
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('../build/index.js', import.meta.url))],
    env: { GNO_RPC_URL: `http://127.0.0.1:${rpc.address().port}` },
    stderr: 'pipe',
  })
  t.after(() => client.close())
  await client.connect(transport)

  const { tools } = await client.listTools()
  assert.equal(tools.length, 9)
  const schema = name => {
    const tool = tools.find(tool => tool.name === name)
    assert.ok(tool, `tool ${name} is advertised`)
    assert.equal(tool.inputSchema.type, 'object')
    return tool.inputSchema
  }
  assert.equal(schema('memba_get_dao').properties.realm_path.default, 'gno.land/r/gov/dao')
  assert.equal(schema('memba_query_render').properties.path.default, '')
  assert.deepEqual(schema('memba_query_render').required, ['realm_path'])
  assert.deepEqual(schema('memba_get_contributors').properties.time_filter.enum, ['all', 'yearly', 'monthly', 'weekly'])
  assert.equal(schema('memba_get_contributors').properties.limit.default, 20)
  assert.equal(schema('memba_get_proposal').properties.proposal_id.type, 'number')

  const dao = await client.callTool({ name: 'memba_get_dao', arguments: {} })
  assert.notEqual(dao.isError, true)
  assert.match(dao.content[0].text, /Fixture DAO/)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].method, 'abci_query')
  assert.equal(Buffer.from(requests[0].params.data, 'base64').toString(), 'gno.land/r/gov/dao:')

  for (const args of [{}, { realm_path: 123 }, { realm_path: 'gno.land/r/gov/dao', path: [] }]) {
    const result = await client.callTool({ name: 'memba_query_render', arguments: args })
    assert.equal(result.isError, true)
    assert.match(result.content[0].text, /invalid|validation/i)
  }
  assert.equal(requests.length, 1, 'invalid inputs must not reach the RPC')
})
