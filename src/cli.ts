import { Command } from 'commander';
import { PixwithAutomation } from './automation/PixwithAutomation';
import { ProxyManager } from './utils/ProxyManager';

const program = new Command();

program
  .name('pixwith-bot')
  .description('CLI tool for creating Pixwith.ai accounts')
  .version('1.0.0');

program
  .requiredOption('-r, --referral <link>', 'Referral link for Pixwith.ai')
  .option('-c, --count <number>', 'Number of accounts to create', '10')
  .option('-p, --proxies <list>', 'Comma separated list of proxies (host:port:user:pass)', '')
  .option('-k, --captcha <key>', '2Captcha API Key', '')
  .option('-y, --yopmail', 'Use Yopmail instead of Mail.tm', false)
  .action(async (options) => {
    const { referral, count, proxies, captcha, yopmail } = options;
    const numCount = parseInt(count);
    const proxyList = proxies ? proxies.split(',').map((p: string) => {
        const [host, port, username, password] = p.split(':');
        return { host, port, username, password };
    }) : [];

    const automation = new PixwithAutomation(captcha);
    const proxyManager = new ProxyManager(proxyList);

    console.log(`🚀 Starting bot... Target: ${numCount} accounts.`);
    if (yopmail) console.log(`📧 Using Yopmail service.`);

    let successCount = 0;
    for (let i = 0; i < numCount; i++) {
        console.log(`\n[Account ${i + 1}/${numCount}] Starting...`);
        const proxy = proxyManager.getNextProxy();
        const success = await automation.createAccount(referral, proxy, yopmail);

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
