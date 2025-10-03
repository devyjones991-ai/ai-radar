jest.mock('axios', () => ({
  post: jest.fn(),
}));

const axios = require('axios');

describe('llm-client', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function loadClient() {
    let client;
    jest.isolateModules(() => {
      client = require('./llm-client');
    });
    return client;
  }

  it('returns a fixture when LLM is disabled', async () => {
    process.env.LLM_ENABLED = 'false';

    const client = loadClient();
    const result = await client.generate('test prompt');

    expect(result.response).toBe(client.DISABLED_COMPLETION.response);
    expect(result.disabled).toBe(true);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('returns a mock completion in mock mode', async () => {
    process.env.LLM_ENABLED = 'true';
    process.env.LLM_MODE = 'mock';

    const client = loadClient();
    const result = await client.generate('test prompt', { model: 'mock-model', options: { temperature: 0.5 } });

    expect(result.response).toBe(client.MOCK_COMPLETION.response);
    expect(result.model).toBe('mock-model');
    expect(result.mode).toBe('mock');
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('delegates to axios in prod mode', async () => {
    process.env.LLM_ENABLED = 'true';
    process.env.LLM_MODE = 'prod';
    process.env.LLM_BASE_URL = 'http://llm.example';

    const client = loadClient();

    axios.post.mockResolvedValueOnce({ data: { response: 'Real response', eval_count: 123 } });

    const context = [
      { role: 'user', content: 'Hi there' },
      { role: 'assistant', content: 'Hello!' },
    ];

    const result = await client.generate('production prompt', {
      model: 'prod-model',
      options: { temperature: 0.7 },
      context,
    });

    expect(axios.post).toHaveBeenCalledWith('http://llm.example/api/generate', {
      model: 'prod-model',
      prompt: 'production prompt',
      stream: false,
      options: { temperature: 0.7, top_p: 0.9 },
      context,
    });
    expect(result).toEqual({ response: 'Real response', evalCount: 123, model: 'prod-model', mode: 'prod' });
  });

  it('не добавляет контекст в payload, если он не передан', async () => {
    process.env.LLM_ENABLED = 'true';
    process.env.LLM_MODE = 'prod';
    process.env.LLM_BASE_URL = 'http://llm.example';

    const client = loadClient();

    axios.post.mockResolvedValueOnce({ data: { response: 'Без контекста', eval_count: 7 } });

    await client.generate('без контекста', { model: 'prod-model' });

    const payload = axios.post.mock.calls[0][1];
    expect(payload).not.toHaveProperty('context');
  });
});
