import * as fs from 'fs';

interface IStore {
  users: { ips: string[]; login: string }[];
}

export let STORE: IStore = {
  users: [],
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

(async () => {
  try {
    const storeFile = JSON.parse(
      fs.readFileSync('./store-data.json', { encoding: 'utf-8' }),
    );

    STORE = {
      ...STORE,
      ...storeFile,
    };
  } catch (error) {}

  while (true) {
    fs.writeFileSync('./store-data.json', JSON.stringify(STORE, null, 2));

    await sleep(1000);
  }
})();
