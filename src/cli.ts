import { Command } from 'commander';
import { PixwithAutomation, MailProvider } from './automation/PixwithAutomation';
import { ProxyManager } from './utils/ProxyManager';
import { config } from './utils/Config';

const program = new Command();

program
  .name('pixwith-bot')
  .description('CLI tool for creating Pixwith.ai accounts')
  .version('1.0.0');

program
  .option('-r, --referral <link>', 'Referral link for Pixwith.ai', config.referralLink)
  .option('-c, --count <number>', 'Number of accounts to create', config.accountCount.toString())
  .option('-p, --proxies <list>', 'Comma separated list of proxies (host:port:user:pass)', config.proxies)
  .option('-k, --captcha <key>', '2Captcha API Key', config.captchaKey)
  .option('-m, --mail <provider>', 'Mail provider (mailtm, yopmail, onesecmail, moakt)', config.mailProvider)
  .action(async (options) => {
    const { referral, count, proxies, captcha, mail } = options;
    const numCount = parseInt(count);
    const proxyList = proxies ? proxies.split(',').map((p: string) => {
        const parts = p.split(':');
        return {
            host: parts[0],
            port: parseInt(parts[1]),
            username: parts[2],
            password: parts[3]
        };
    }) : [];

    const automation = new PixwithAutomation(captcha);
    const proxyManager = new ProxyManager(proxyList);

    console.log(`🚀 Starting bot... Target: ${numCount} accounts.`);
    console.log(`📧 Using Mail Provider: ${mail}`);

    let successCount = 0;
    for (let i = 0; i < numCount; i++) {
        console.log(`\n[Account ${i + 1}/${numCount}] Starting...`);
        const proxy = proxyManager.getNextProxy();
        const success = await automation.createAccount(referral, proxy, mail as MailProvider);

        if (success) {
            successCount++;
            console.log(`✅ Success! Total: ${successCount}`);
        } else {
            console.log(`❌ Failed.`);
        }

        if (i < numCount - 1) {
            console.log('Waiting 10 seconds before next attempt...');
            await new Promise(resolve => setTimeout(resolve, 10000));
        }
    }

    console.log(`\n✨ Finished! Created ${successCount}/${numCount} accounts.`);
    process.exit(0);
  });

program.parse(process.argv);
