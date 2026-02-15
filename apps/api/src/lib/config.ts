/**
 * Environment configuration with validation at startup
 * Fails fast with clear error messages if required configuration is missing
 */

interface Config {
  // Neo4j Database
  neo4jUri: string;
  neo4jUser: string;
  neo4jPassword: string;

  // Server
  port: number;
  nodeEnv: 'development' | 'production' | 'test';

  // CORS
  corsOrigin: string | undefined;

  // External APIs
  nimiqRpcUrl: string;
}

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  return value;
}

function getOptionalEnv(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

function validateConfig(): Config {
  const errors: string[] = [];

  // Collect all validation errors before throwing
  let neo4jUri: string | undefined;
  try {
    neo4jUri = getRequiredEnv('NEO4J_URI');
  } catch (e) {
    errors.push((e as Error).message);
  }

  let neo4jPassword: string | undefined;
  try {
    neo4jPassword = getRequiredEnv('NEO4J_PASSWORD');
  } catch (e) {
    errors.push((e as Error).message);
  }

  const neo4jUser = getOptionalEnv('NEO4J_USER', 'neo4j');

  const portStr = getOptionalEnv('PORT', '3001');
  const port = parseInt(portStr, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    errors.push(`Invalid PORT value: ${portStr}. Must be a number between 1 and 65535`);
  }

  const nodeEnv = getOptionalEnv('NODE_ENV', 'development') as Config['nodeEnv'];
  if (!['development', 'production', 'test'].includes(nodeEnv)) {
    errors.push(`Invalid NODE_ENV value: ${nodeEnv}. Must be development, production, or test`);
  }

  const corsOrigin = process.env.CORS_ORIGIN;
  const nimiqRpcUrl = getOptionalEnv('NIMIQ_RPC_URL', 'http://localhost:8648');

  // Validate URL format for external APIs
  try {
    new URL(nimiqRpcUrl);
  } catch {
    errors.push(`Invalid NIMIQ_RPC_URL: ${nimiqRpcUrl}. Must be a valid URL`);
  }

  // Production-specific validations
  if (nodeEnv === 'production') {
    if (!corsOrigin || corsOrigin === '*') {
      errors.push('CORS_ORIGIN must be explicitly set in production (not * or empty)');
    }
  }

  // If any errors, throw with all messages
  if (errors.length > 0) {
    console.error('❌ Configuration validation failed:');
    errors.forEach((err) => console.error(`   - ${err}`));
    throw new Error(`Configuration validation failed with ${errors.length} error(s)`);
  }

  return {
    neo4jUri: neo4jUri!,
    neo4jUser,
    neo4jPassword: neo4jPassword!,
    port,
    nodeEnv,
    corsOrigin,
    nimiqRpcUrl,
  };
}

// Export validated config (throws on invalid config at import time)
export const config = validateConfig();

// Log successful configuration (without sensitive values)
console.log('✅ Configuration validated successfully');
console.log(`   Environment: ${config.nodeEnv}`);
console.log(`   Port: ${config.port}`);
console.log(`   Neo4j URI: ${config.neo4jUri}`);
console.log(`   Nimiq RPC: ${config.nimiqRpcUrl}`);
console.log(`   CORS Origin: ${config.corsOrigin || '(development mode: all origins)'}`);
