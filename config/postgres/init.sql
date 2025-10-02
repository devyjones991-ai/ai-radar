-- Создание расширений
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Таблица пользователей
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    telegram_id BIGINT UNIQUE NOT NULL,
    username VARCHAR(255),
    subscription_tier VARCHAR(50) DEFAULT 'free',
    subscription_end TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Таблица товаров
CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    external_id VARCHAR(255) NOT NULL,
    name TEXT NOT NULL,
    price INTEGER NOT NULL,
    rating DECIMAL(3,2),
    feedbacks INTEGER DEFAULT 0,
    brand VARCHAR(255),
    category VARCHAR(255) NOT NULL,
    source VARCHAR(50) NOT NULL,
    url TEXT,
    position_rank INTEGER,
    parsed_at TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(external_id, source)
);

-- Таблица метрик товаров (для расчета роста)
CREATE TABLE product_metrics (
    id SERIAL PRIMARY KEY,
    product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
    price INTEGER NOT NULL,
    rating DECIMAL(3,2),
    feedbacks INTEGER,
    position_rank INTEGER,
    growth_rate DECIMAL(5,2) DEFAULT 0,
    price_change_percent DECIMAL(5,2) DEFAULT 0,
    recorded_at TIMESTAMP DEFAULT NOW()
);

-- Таблица алертов пользователей
CREATE TABLE user_alerts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    keyword VARCHAR(255),
    competitor VARCHAR(255),
    category VARCHAR(255),
    threshold DECIMAL(5,2) DEFAULT 5.0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Таблица истории AI сессий (для памяти)
CREATE TABLE ai_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    session_id VARCHAR(255) NOT NULL,
    message_text TEXT NOT NULL,
    role VARCHAR(20) NOT NULL, -- 'user' или 'assistant'
    model_used VARCHAR(100),
    tokens_used INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Таблица дайджестов
CREATE TABLE digest_history (
    id SERIAL PRIMARY KEY,
    digest_type VARCHAR(50) NOT NULL, -- 'daily', 'weekly'
    category VARCHAR(255),
    content TEXT NOT NULL,
    ai_comment TEXT,
    sent_at TIMESTAMP DEFAULT NOW()
);

-- Индексы для производительности
CREATE INDEX idx_products_category ON products(category);
CREATE INDEX idx_products_source ON products(source);
CREATE INDEX idx_products_parsed_at ON products(parsed_at DESC);
CREATE INDEX idx_metrics_product_id ON product_metrics(product_id);
CREATE INDEX idx_metrics_recorded_at ON product_metrics(recorded_at DESC);
CREATE INDEX idx_users_telegram_id ON users(telegram_id);
CREATE INDEX idx_sessions_session_id ON ai_sessions(session_id);
CREATE INDEX idx_sessions_created_at ON ai_sessions(created_at DESC);

-- Функция для обновления updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Триггеры для автообновления updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    
CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
