import * as fs from 'fs';

interface IStore {
  loggedInIps: string[];
}

export let STORE: IStore = {
  loggedInIps: [],
};

function sleep(seconds: number) {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

(async () => {
  try {
    const storeFile = JSON.parse(fs.readFileSync('./store-data.json', { encoding: 'utf-8' }));

    STORE = {
      ...STORE,
      ...storeFile,
    };
  } catch (error) {}

  while (true) {
    fs.writeFileSync('./store-data.json', JSON.stringify(STORE));

    await sleep(1);
  }
})();
