// Fetch polyfills loaded via jest.polyfills.js (setupFiles)
import '@testing-library/jest-dom'
import { setupMockServer } from './__tests__/mocks/server'

// Mock environment variables
process.env.GROQ_API_KEY = 'test-groq-api-key'
process.env.GROQ_BASE_URL = 'https://api.groq.com/openai/v1'
process.env.GROQ_MODEL = 'llama-3.3-70b-versatile'
process.env.UPSTASH_VECTOR_REST_URL = 'https://test-index.upstash.io'
process.env.UPSTASH_VECTOR_REST_TOKEN = 'test-upstash-token'
process.env.UPSTASH_NAMESPACE = ''
process.env.UPSTASH_TOP_K = '5'
process.env.UPSTASH_SCORE_THRESHOLD = '0.68'

// Setup MSW server for API mocking
setupMockServer()

// Mock localStorage
const localStorageMock = (() => {
  let store = {}
  return {
    getItem: jest.fn((key) => store[key] || null),
    setItem: jest.fn((key, value) => {
      store[key] = value.toString()
    }),
    removeItem: jest.fn((key) => {
      delete store[key]
    }),
    clear: jest.fn(() => {
      store = {}
    }),
  }
})()

global.localStorage = localStorageMock

// Mock crypto.randomUUID
global.crypto = {
  randomUUID: () => 'test-uuid-' + Math.random().toString(36).substring(7),
}

// Reset mocks before each test
beforeEach(() => {
  localStorageMock.clear()
})
