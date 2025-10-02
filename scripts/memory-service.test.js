const request = require('supertest');

const mockPgPool = {
  query: jest.fn(),
  connect: jest.fn(),
  end: jest.fn(),
};

// Mock the 'pg' module
jest.mock('pg', () => ({
  Pool: jest.fn(() => mockPgPool),
}));

jest.mock('./llm-client', () => ({
  generate: jest.fn(),
  MOCK_COMPLETION: { response: 'Mocked LLM response', evalCount: 0 },
  DISABLED_COMPLETION: { response: 'LLM service is disabled', evalCount: 0 },
}));

const llmClient = require('./llm-client');
const axios = require('axios');
const { app, getSessionContext, saveMessage, pool } = require('./memory-service');

describe('Memory Service', () => {
  let mockPool;

  beforeEach(() => {
    // Reset mocks before each test
    mockPgPool.query.mockReset();
    mockPgPool.connect.mockReset();
    mockPgPool.end.mockReset();
  });