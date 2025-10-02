const axios = require('axios');

async function testOllamaConnection() {
  try {
    const response = await axios.get('http://host.docker.internal:11434/api/tags');
    console.log('✅ Ollama connection successful');
    console.log('Available models:', response.data.models?.map(m => m.name) || []);

    const modelForSmokeTest = response.data.models?.[0]?.name;
    if (modelForSmokeTest) {
      await testZeroTemperatureAndTopP(modelForSmokeTest);
    } else {
      console.warn('⚠️ Нет доступных моделей для smoke-теста generate.');
    }
  } catch (error) {
    console.error('❌ Ollama connection failed:', error.message);
  }
}

async function testZeroTemperatureAndTopP(model) {
  try {
    const response = await axios.post('http://host.docker.internal:11434/api/generate', {
      model,
      prompt: 'Smoke test prompt',
      stream: false,
      options: {
        temperature: 0,
        top_p: 0,
      },
    });

    console.log(`✅ Генерация с temperature=0 и top_p=0 для модели ${model} прошла успешно`);
    console.log('Ответ (усечённый):', String(response.data.response).slice(0, 100));
  } catch (error) {
    console.error(`❌ Ошибка генерации с temperature=0 и top_p=0 для модели ${model}:`, error.message);
  }
}

testOllamaConnection();
