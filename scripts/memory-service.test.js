const request = require('supertest');

jest.mock('pg', () => {
  const mPool = {
    query: jest.fn(),
    connect: jest.fn(),
    end: jest.fn(),
  };
  return { Pool: jest.fn(() => mPool) };
});

jest.mock('./llm-client', () => ({
  generate: jest.fn(),
  MOCK_COMPLETION: { response: 'Mocked LLM response', evalCount: 0 },
  DISABLED_COMPLETION: { response: 'LLM service is disabled', evalCount: 0 },
}));

const llmClient = require('./llm-client');
const { app, getSessionContext, saveMessage, pool } = require('./memory-service');

describe('Memory Service', () => {
  let mockPool;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPool = pool;
  });

  describe('Database Functions', () => {
    describe('getSessionContext', () => {
      it('should retrieve session context from the database', async () => {
        const mockRows = [
          { role: 'user', message_text: 'Hello', model_used: 'test-model', created_at: new Date() },
          { role: 'assistant', message_text: 'Hi there!', model_used: 'test-model', created_at: new Date() },
        ];
        mockPool.query.mockResolvedValueOnce({ rows: mockRows, rowCount: mockRows.length });

        const context = await getSessionContext('test-session-id');
        expect(mockPool.query).toHaveBeenCalledWith(
          'SELECT role, message_text, model_used, created_at FROM ai_sessions WHERE session_id = $1 ORDER BY created_at DESC LIMIT $2',
          ['test-session-id', 10]
        );
        expect(context).toEqual(mockRows.reverse());
      });

      it('should return an empty array on database error', async () => {
        mockPool.query.mockRejectedValueOnce(new Error('DB error'));
        const context = await getSessionContext('test-session-id');
        expect(context).toEqual([]);
      });
    });

    describe('saveMessage', () => {
      it('should save a message to the database', async () => {
        await saveMessage('test-session-id', 'user', 'Test message', 'test-model', 100);
        expect(mockPool.query).toHaveBeenCalledWith(
          'INSERT INTO ai_sessions (session_id, role, message_text, model_used, tokens_used) VALUES ($1, $2, $3, $4, $5)',
          ['test-session-id', 'user', 'Test message', 'test-model', 100]
        );
      });

      it('should handle database errors when saving a message', async () => {
        mockPool.query.mockRejectedValueOnce(new Error('DB error'));
        await expect(saveMessage('test-session-id', 'user', 'Test message')).resolves.not.toThrow();
      });
    });
  });

  describe('API Endpoints', () => {
    describe('GET /health', () => {
      it('should return a 200 OK status', async () => {
        const response = await request(app).get('/health');
        expect(response.status).toBe(200);
        expect(response.body.status).toBe('ok');
      });
    });

    describe('POST /chat-with-memory', () => {
      it('should return a response from the AI model and save the conversation', async () => {
        const mockContext = [];
        const llmResponse = { response: 'AI response', evalCount: 50, model: 'deepseek-r1:70b' };

        mockPool.query.mockResolvedValueOnce({ rows: mockContext, rowCount: 0 });
        llmClient.generate.mockResolvedValueOnce(llmResponse);
        mockPool.query.mockResolvedValueOnce(undefined);
        mockPool.query.mockResolvedValueOnce(undefined);

        const response = await request(app)
          .post('/chat-with-memory')
          .send({ message: 'Hello, AI!', sessionId: 'test-session' });

        expect(response.status).toBe(200);
        expect(response.body.response).toBe('AI response');
        expect(response.body.evalCount).toBe(50);
        expect(llmClient.generate).toHaveBeenCalled();
        expect(mockPool.query).toHaveBeenCalledTimes(3);
      });

      it('should return a deterministic response when LLM is disabled', async () => {
        const mockContext = [];
        const disabledResponse = { response: 'LLM service is disabled', evalCount: 0, disabled: true, model: 'deepseek-r1:70b' };

        mockPool.query.mockResolvedValueOnce({ rows: mockContext, rowCount: 0 });
        llmClient.generate.mockResolvedValueOnce(disabledResponse);
        mockPool.query.mockResolvedValueOnce(undefined);
        mockPool.query.mockResolvedValueOnce(undefined);

        const response = await request(app)
          .post('/chat-with-memory')
          .send({ message: 'Hello, AI!', sessionId: 'test-session' });

        expect(response.status).toBe(200);
        expect(response.body.response).toBe(disabledResponse.response);
        expect(response.body.llmDisabled).toBe(true);
        expect(mockPool.query).toHaveBeenCalledTimes(3);
      });

      it('should handle errors from the LLM client gracefully', async () => {
        mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
        llmClient.generate.mockRejectedValueOnce(new Error('LLM error'));

        const response = await request(app)
          .post('/chat-with-memory')
          .send({ message: 'Hello, AI!', sessionId: 'test-session' });

        expect(response.status).toBe(500);
        expect(response.body.error).toBe('Failed to generate response');
      });
    });
  });
});
