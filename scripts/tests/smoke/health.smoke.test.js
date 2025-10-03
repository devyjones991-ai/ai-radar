const request = require('supertest');
const { createService } = require('../../memory-service');

describe('Smoke: /health', () => {
  it('возвращает статус ok и метку времени', async () => {
    const poolStub = { query: jest.fn() };
    const llmClient = { generate: jest.fn() };
    const { app } = createService({ pool: poolStub, llmClient });

    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        status: 'ok',
        timestamp: expect.any(String),
      })
    );
  });
});
