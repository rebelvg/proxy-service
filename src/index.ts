import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs';
import { URL } from 'url';
import * as net from 'net';
import * as _ from 'lodash';
import * as socks5 from '@heroku/socksv5';

import { config } from '../config';
import { STORE } from './store';

const socksServer: net.Server = socks5.createServer((info, accept, deny) => {
  if (!_.find(STORE.loggedInIps, (ip) => ip.includes(info.srcAddr))) {
    deny();

    return;
  }

  accept();
});

(socksServer as any).useAuth(socks5.auth.None());

function verifyUser(proxyAuth: string, ipAddress: string): boolean {
  if (_.find(STORE.loggedInIps, (ip) => ip.includes(ipAddress))) {
    return true;
  }

  if (!proxyAuth) {
    return false;
  }

  const baseToBuffer = Buffer.from(proxyAuth.slice(6), 'base64');

  const authString = baseToBuffer.toString('ascii');

  const [login, password] = authString.split(':');

  const user = _.find(config.users, { login, password });

  if (!user) {
    return false;
  }

  if (!STORE.loggedInIps.includes(ipAddress)) {
    console.log('added_ip_socks_list', ipAddress);

    STORE.loggedInIps.push(ipAddress);
  }

  return true;
}

function onConnect(
  req: http.IncomingMessage,
  socket: net.Socket,
  head: Buffer,
) {
  socket.on('error', (err) => {
    console.log('socket', err.message, req.url);

    socket.end();
  });

  const [urlHost, urlPort] = req.url.split(':');

  const port = parseInt(urlPort);

  const isAuthorized = verifyUser(
    req.headers['proxy-authorization'],
    socket.remoteAddress,
  );

  if (!isAuthorized) {
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
    console.log('netConnect', err.message, req.url, urlHost);

    socket.end();
  });
}

function onRequest(
  clientReq: http.IncomingMessage,
  clientRes: http.ServerResponse,
) {
  const url = new URL(clientReq.url);

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

  const isAuthorized = verifyUser(
    clientReq.headers['proxy-authorization'],
    clientReq.socket.remoteAddress,
  );

  if (!isAuthorized) {
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
    console.log('proxy', err.message, clientReq.url, url.hostname);

    clientRes.write(err.message, 'utf8');

    clientRes.end();
  });

  clientReq.pipe(proxy, {
    end: true,
  });
}

process.on('unhandledRejection', (reason, p) => {
  throw reason;
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
