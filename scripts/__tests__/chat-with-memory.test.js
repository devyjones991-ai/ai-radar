const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const pg = require('pg');

test('chat-with-memory передает нулевые temperature и top_p в Ollama', async () => {
  const queryMock = mock.fn(async () => ({ rows: [] }));
  mock.method(pg, 'Pool', function MockPool() {
    return { query: queryMock, end: mock.fn() };
  });
  process.env.NODE_ENV = 'test';
  const modulePath = require.resolve('../memory-service');
  delete require.cache[modulePath];

  try {
    const { createService } = require('../memory-service');

    const llmMock = {
      generate: mock.fn(async () => ({
        response: 'assistant response',
        evalCount: 42,
        model: 'test-model',
      })),
    };

    const { app } = createService({
      pool: { query: queryMock },
      llmClient: llmMock,
      defaultModel: 'test-model',
    });

    const res = await request(app)
      .post('/chat')
      .send({
        message: 'Hello',
        sessionId: 'session-1',
        options: {
          temperature: 0,
          top_p: 0,
        },
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.response, 'assistant response');
    assert.equal(queryMock.mock.callCount(), 3);

    const optionsArg = llmMock.generate.mock.calls[0].arguments[1].options;
    assert.equal(optionsArg.temperature, 0);
    assert.equal(optionsArg.top_p, 0);
  } finally {
    mock.restoreAll();
    delete require.cache[modulePath];
    delete process.env.NODE_ENV;
  }
});
