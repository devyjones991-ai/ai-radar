const axios = require('axios');

const DEFAULT_MODEL = process.env.LLM_DEFAULT_MODEL || 'deepseek-r1:70b';
const DEFAULT_OPTIONS = { temperature: 0.3, top_p: 0.9 };

const MOCK_COMPLETION = Object.freeze({
  response: 'Mocked LLM response',
  evalCount: 0,
});

const DISABLED_COMPLETION = Object.freeze({
  response: 'LLM service is disabled',
  evalCount: 0,
});

function isEnabled() {
  const value = String(process.env.LLM_ENABLED ?? 'true').toLowerCase();
  return !['false', '0', 'off', 'no'].includes(value);
}

function resolveMode() {
  return (process.env.LLM_MODE || 'prod').toLowerCase();
}

function resolveBaseUrl() {
  return process.env.LLM_BASE_URL || 'http://host.docker.internal:11434';
}

async function generate(prompt, { model = DEFAULT_MODEL, options: llmOptions = {} } = {}) {
  if (!prompt) {
    throw new Error('Prompt is required');
  }

  if (!isEnabled()) {
    return { ...DISABLED_COMPLETION, model, disabled: true };
  }

  const mode = resolveMode();
  if (mode === 'mock') {
    return { ...MOCK_COMPLETION, model, mode };
  }

  const payload = {
    model,
    prompt,
    stream: false,
    options: { ...DEFAULT_OPTIONS, ...llmOptions },
  };

  const baseUrl = resolveBaseUrl();
  const { data } = await axios.post(`${baseUrl}/api/generate`, payload);

  return {
    response: data?.response,
    evalCount: data?.eval_count ?? null,
    model,
    mode: 'prod',
  };
}

module.exports = {
  generate,
  MOCK_COMPLETION,
  DISABLED_COMPLETION,
};
