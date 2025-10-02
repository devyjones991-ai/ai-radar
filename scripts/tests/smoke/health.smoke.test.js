const request = require('supertest');
const { createApp } = require('../../memory-service');

describe('Smoke: /health', () => {
  it('возвращает статус ok и метку времени', async () => {
    const poolStub = { query: jest.fn() };
    const axiosStub = { post: jest.fn() };
    const app = createApp({ pool: poolStub, axiosInstance: axiosStub });

    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        status: 'ok',
        timestamp: expect.any(String),
      }),
    );
  });
});
