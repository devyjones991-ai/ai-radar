const mockPgPool = {
  query: jest.fn(),
  connect: jest.fn(),
  end: jest.fn(),
};

// Mock the 'pg' module
jest.mock('pg', () => ({
  Pool: jest.fn(() => mockPgPool),
}));

// Mock 'axios'
jest.mock('axios');

const request = require('supertest');
const axios = require('axios');
const { app, getSessionContext, saveMessage, pool } = require('./memory-service');

describe('Memory Service', () => {
  let mockPool;

  beforeEach(() => {
    // Reset mocks before each test
    mockPgPool.query.mockReset();
    mockPgPool.connect.mockReset();
    mockPgPool.end.mockReset();
    jest.clearAllMocks();
    mockPool = pool;
  });

  // Unit tests for database functions
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
        // We are just checking that the error is caught, so no assertion is needed here.
        // The function should not throw an error.
        await expect(saveMessage('test-session-id', 'user', 'Test message')).resolves.not.toThrow();
      });
    });
  });

  // Integration tests for API endpoints
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
        const mockOllamaResponse = { data: { response: 'AI response', eval_count: 50 } };

        mockPool.query.mockResolvedValueOnce({ rows: mockContext, rowCount: 0 }); // getSessionContext
        axios.post.mockResolvedValueOnce(mockOllamaResponse);
        mockPool.query.mockResolvedValueOnce(undefined); // First saveMessage
        mockPool.query.mockResolvedValueOnce(undefined); // Second saveMessage

        const response = await request(app)
          .post('/chat-with-memory')
          .send({ message: 'Hello, AI!', sessionId: 'test-session' });

        expect(response.status).toBe(200);
        expect(response.body.response).toBe('AI response');
        expect(axios.post).toHaveBeenCalled();
        expect(mockPool.query).toHaveBeenCalledTimes(3); // 1 for get, 2 for save
      });

      it('should handle errors from the Ollama service', async () => {
        mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
        axios.post.mockRejectedValueOnce(new Error('Ollama error'));

        const response = await request(app)
          .post('/chat-with-memory')
          .send({ message: 'Hello, AI!', sessionId: 'test-session' });

        expect(response.status).toBe(500);
        expect(response.body.error).toBe('Ollama error');
      });
    });
  });
});