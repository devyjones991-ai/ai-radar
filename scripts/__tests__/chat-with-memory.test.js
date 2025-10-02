const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const pg = require('pg');

function createMockResponse() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test('chat-with-memory передает нулевые temperature и top_p в Ollama', async () => {
  const queryMock = mock.fn(async () => ({ rows: [] }));
  mock.method(pg, 'Pool', function MockPool() {
    return { query: queryMock };
  });
  const axiosPostMock = mock.method(axios, 'post', async () => ({
    data: {
      response: 'assistant response',
      eval_count: 42,
    },
  }));

  process.env.NODE_ENV = 'test';
  const modulePath = require.resolve('../memory-service');
  delete require.cache[modulePath];

  try {
    const { chatWithMemoryHandler } = require('../memory-service');

    const req = {
      body: {
        message: 'Hello',
        sessionId: 'session-1',
        options: {
          temperature: 0,
          top_p: 0,
        },
      },
    };
    const res = createMockResponse();

    await chatWithMemoryHandler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.response, 'assistant response');
    assert.equal(queryMock.mock.calls.length, 3);

    const optionsArg = axiosPostMock.mock.calls[0].arguments[1].options;
    assert.equal(optionsArg.temperature, 0);
    assert.equal(optionsArg.top_p, 0);
  } finally {
    mock.restoreAll();
    delete require.cache[modulePath];
    delete process.env.NODE_ENV;
  }
});
