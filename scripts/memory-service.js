151
function createApp({ pool: providedPool, llmClient: providedLlmClient, defaultModel } = {}) {
152
  const app = express();
153
  app.use(express.json());
154
​
155
  const activePool = providedPool ?? pool;
156
  const activeLlmClient = providedLlmClient ?? llmClient;
157
​
158
  app.get('/health', (req, res) => {
159
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
160
  });
161
​
162
  const handler = chatWithMemoryHandler({ pool: activePool, llmClient: activeLlmClient, defaultModel });
163
​
164
  app.post('/chat-with-memory', handler);
165
​
166
  app.pool = activePool;
167
  app.getSessionContext = (sessionId, limit) => getSessionContext(sessionId, limit, activePool);
168
  app.saveMessage = (sessionId, role, message, modelUsed, tokensUsed) =>
169
    saveMessage(sessionId, role, message, modelUsed, tokensUsed, activePool);
170
​
171
  return app;
172
}
173
​
174
module.exports = {
175
  createApp,
176
  chatWithMemoryHandler,
177
  getSessionContext,
178
  saveMessage,
179
  createPool,
180
  pool,
181
};
182
​
183
if (require.main === module) {
184
  const app = createApp();
185
  const port = process.env.PORT || 3000;
186
​
187
  app.listen(port, () => {
188
    console.log(`Memory service listening on port ${port}`);
189
  });
190
}
191
​