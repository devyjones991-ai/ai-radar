const axios = require('axios');

async function testOllamaConnection() {
  try {
    const response = await axios.get('http://host.docker.internal:11434/api/tags');
    console.log('✅ Ollama connection successful');
    console.log('Available models:', response.data.models?.map(m => m.name) || []);
  } catch (error) {
    console.error('❌ Ollama connection failed:', error.message);
  }
}

testOllamaConnection();
