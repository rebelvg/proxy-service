import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const {
  TLS_KEY_PATH,
  TLS_CERT_PATH,
  HTTP_PORT,
  HTTPS_PORT,
  SOCKS_PORT,
  USERS,
} = process.env;

export const config = {
  key: TLS_KEY_PATH || null,
  cert: TLS_CERT_PATH || null,
  httpPort: HTTP_PORT || null,
  httpsPort: HTTPS_PORT || null,
  socksPort: SOCKS_PORT || null,
  users: JSON.parse(USERS),
};

console.log(config);
