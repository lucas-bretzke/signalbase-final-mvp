import { mkdir } from 'node:fs/promises';
import readline from 'node:readline/promises';
import puppeteer from 'puppeteer';
import { config } from './config.mjs';

await mkdir(config.profileDirectory, { recursive: true });
const browser = await puppeteer.launch({
  headless: false,
  userDataDir: config.profileDirectory,
  executablePath: config.executablePath,
  defaultViewport: null,
  args: ['--lang=pt-BR', '--start-maximized'],
});

const [page] = await browser.pages();
await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs });
console.log('Entre no LinkedIn na janela aberta. Resolva qualquer verificacao manualmente.');
console.log(`A sessao sera guardada somente em: ${config.profileDirectory}`);

const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
await terminal.question('Quando a pagina inicial do LinkedIn estiver aberta, pressione Enter aqui... ');
terminal.close();
await browser.close();
console.log('Sessao salva. Agora inicie o sistema com npm run dev.');
