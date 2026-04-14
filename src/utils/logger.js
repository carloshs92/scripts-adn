import chalk from 'chalk';

export const logger = {
  success: (msg) => console.log(chalk.green(`✅ ${msg}`)),
  error: (msg) => console.error(chalk.red(`❌ ${msg}`)),
  warn: (msg) => console.log(chalk.yellow(`⚠️  ${msg}`)),
  info: (msg) => console.log(chalk.cyan(`ℹ️  ${msg}`)),
  debug: (msg) => console.log(chalk.gray(`🔍 ${msg}`)),
  header: (msg) => console.log(chalk.blue.bold(`\n${msg}\n`)),
  section: (msg) => console.log(chalk.cyan(`\n${msg}`)),
  processing: (msg) => console.log(chalk.yellow(`⏳ ${msg}`)),
};

export default logger;
