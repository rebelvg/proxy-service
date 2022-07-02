import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs';
import { URL } from 'url';
import * as net from 'net';
import * as _ from 'lodash';
import * as socks5 from '@heroku/socksv5';

import { config } from './config';
import { STORE } from './store';

const socksServer: net.Server = socks5.createServer((info, accept, deny) => {
  if (
    !_.find(STORE.users, (storeRecord) =>
      storeRecord.ips.includes(info.srcAddr),
    )
  ) {
    deny();

    return;
  }

  accept();
});

(socksServer as any).useAuth(socks5.auth.None());

function verifyUser(proxyAuth: string, ipAddress: string): string {
  const foundStoreRecord = _.find(STORE.users, (storeRecord) =>
    storeRecord.ips.includes(ipAddress),
  );

  if (foundStoreRecord) {
    return foundStoreRecord.login;
  }

  if (!proxyAuth) {
    return null;
  }

  const baseToBuffer = Buffer.from(proxyAuth.slice(6), 'base64');

  const authString = baseToBuffer.toString('ascii');

  const [login, password] = authString.split(':');

  const user = _.find(config.users, { login, password });

  if (!user) {
    return null;
  }

  const foundUser = _.find(STORE.users, { login });

  if (!foundUser) {
    STORE.users.push({
      ips: [ipAddress],
      login,
    });
  } else {
    foundUser.ips.push(ipAddress);
  }

  return login;
}

function onConnect(
  req: http.IncomingMessage,
  socket: net.Socket,
  head: Buffer,
) {
  const login = verifyUser(
    req.headers['proxy-authorization'],
    socket.remoteAddress,
  );

  socket.on('error', (err) => {
    console.error('socket_error', login, err.message, req.url);

    socket.end();
  });

  const [urlHost, urlPort] = req.url.split(':');

  const port = parseInt(urlPort);

  if (!login) {
    socket.write(
      `${[
        'HTTP/1.1 407 Proxy Authentication Required',
        'Proxy-Authenticate: Basic',
      ].join('\n')}\n\n`,
      () => {
        socket.end();
      },
    );

    return;
  }

  const netConnect = net.connect(port, urlHost, () => {
    socket.write(`${['HTTP/1.1 200 OK'].join('\n')}\n\n`, () => {
      netConnect.pipe(socket);

      socket.pipe(netConnect);
    });
  });

  netConnect.on('error', (err) => {
    console.error('net_connect_error', login, err.message, req.url, urlHost);

    socket.end();
  });
}

function onRequest(
  clientReq: http.IncomingMessage,
  clientRes: http.ServerResponse,
) {
  let url: URL;

  try {
    url = new URL(clientReq.url);
  } catch (error) {
    clientRes.end();

    return;
  }

  const options = {
    hostname: url.hostname,
    port: url.port,
    path: ''.concat(url.pathname, url.search, url.hash),
    method: clientReq.method,
    headers: {
      ...clientReq.headers,
      host: url.host,
    },
  };

  const login = verifyUser(
    clientReq.headers['proxy-authorization'],
    clientReq.socket.remoteAddress,
  );

  if (!login) {
    clientRes.writeHead(407, { 'Proxy-Authenticate': 'Basic' });

    clientRes.end();

    return;
  }

  let proxy: http.ClientRequest;

  switch (url.protocol) {
    case 'http:': {
      proxy = http.request(options, (res) => {
        clientRes.writeHead(res.statusCode, res.headers);

        res.pipe(clientRes, {
          end: true,
        });
      });

      break;
    }
    case 'https:': {
      proxy = https.request(options, (res) => {
        clientRes.writeHead(res.statusCode, res.headers);

        res.pipe(clientRes, {
          end: true,
        });
      });

      break;
    }
    default: {
      clientRes.end();

      break;
    }
  }

  proxy.on('error', (err) => {
    console.error(
      'proxy_error',
      login,
      err.message,
      clientReq.url,
      url.hostname,
    );

    clientRes.write(err.message, 'utf8');

    clientRes.end();
  });

  clientReq.pipe(proxy, {
    end: true,
  });
}

process.on('unhandledRejection', (error, p) => {
  console.error(error);

  throw 1;
});

if (config.httpPort) {
  const httpServer = http.createServer(onRequest);

  httpServer.on('connect', onConnect);

  httpServer.on('error', (err) => {
    console.error('http_server_error', err);
  });

  httpServer.listen(config.httpPort);

  console.log('http_proxy_running');
}

if (config.httpsPort) {
  const httpsServer = https.createServer(
    {
      key: fs.readFileSync(config.key),
      cert: fs.readFileSync(config.cert),
    },
    onRequest,
  );

  httpsServer.on('connect', onConnect);

  httpsServer.on('error', (err) => {
    console.error('http_server_error', err);
  });

  httpsServer.listen(config.httpsPort);

  console.log('https_proxy_running');
}

if (config.socksPort) {
  socksServer.listen(config.socksPort, () => {
    console.log('socks_server_running');
  });
}
