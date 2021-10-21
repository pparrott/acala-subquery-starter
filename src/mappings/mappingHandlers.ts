import { SubstrateEvent } from "@subql/types";
import { Codec } from "@polkadot/types/types";
import { AccountBalance, Account, CurrencyTransfer, LiquidityDailySummary } from "../types";
import { Balance } from "@polkadot/types/interfaces";
import { Int } from "@polkadot/types";

async function getAccountBalance(address: string, currency: string): Promise<AccountBalance> {

  let accountBalance = await AccountBalance.get(address + currency);
  // creates an account balance if it doesn't already exist
  if (!accountBalance) {
    accountBalance = new AccountBalance(address + currency);
    // init balance of 0 and assign currency
    accountBalance.accountId = address;
    accountBalance.balance = '0';
    accountBalance.currency = currency;

    await accountBalance.save();
  }

  return accountBalance;
}

async function getAccount(address: string): Promise<Account> {
  // Creates an account if it doesn't exist
  let account = await Account.get(address); 
  if (!account) {
    account = new Account(address);
    await account.save();
  }
  return account;
}

async function getDailyPool(token0: string, token1: string, day: string): Promise<LiquidityDailySummary> {
  const dailyPoolId = token0 + '|' + token1 + '|' + day;
  // creates the daily pool if it doesn't exist
  let dailyPool = await LiquidityDailySummary.get(dailyPoolId);

  if(!dailyPool) {
    dailyPool = new LiquidityDailySummary(dailyPoolId); 
    dailyPool.token0 = token0;
    dailyPool.token1 = token1;
    dailyPool.date = day;
    dailyPool.token0DailyTotal = '0';
    dailyPool.token1DailyTotal = '0';
    await dailyPool.save()
  }

  return dailyPool
}

async function updateBalance(accountBalance: AccountBalance, to_from: string, amount: string, transferId: string, transferTime: bigint): Promise<void> {
  // Generate transfer record
  const transferRecord = new CurrencyTransfer(`${transferId}-${to_from}`);
  transferRecord.accountBalanceId = accountBalance.id;
  transferRecord.date = transferTime.toString();

  if (to_from == 'from') {
    accountBalance.balance = (parseFloat(accountBalance.balance) - parseFloat(amount)).toString();
    transferRecord.amount = (-1 * parseFloat(amount)).toString();
  } else {
    accountBalance.balance = (parseFloat(accountBalance.balance) + parseFloat(amount)).toString();
    transferRecord.amount = (parseFloat(amount)).toString();
  }
  
  await transferRecord.save();
  await accountBalance.save();

  return
}

async function updateDailyPool(dailyPool: LiquidityDailySummary, token0Amt: string, token1Amt: string, add_remove: string): Promise<void> {
  let addFactor: bigint
  
  if (add_remove == 'remove') addFactor = BigInt(-1);
  else addFactor = BigInt(1);

  dailyPool.token0DailyTotal = (BigInt(dailyPool.token0DailyTotal) + addFactor * BigInt(token0Amt)).toString();
  dailyPool.token1DailyTotal = (BigInt(dailyPool.token1DailyTotal) + addFactor * BigInt(token1Amt)).toString();

  await dailyPool.save()

  return
}

function getTransferToken(currencyId: Codec): string[] {
  const currencyJson = JSON.parse(currencyId.toString());

  if (currencyJson.token) return [currencyJson.token, currencyJson.token];
  if (currencyJson.dexShare) {
    const [tokenA, tokenB] = currencyJson.dexShare;
    return [tokenA, tokenB];
  }

  return [];
}

function getLiquidityToken(currencyId: Codec): string {
  const currencyJson = JSON.parse(currencyId.toString());

  if (currencyJson.token) return currencyJson.token;
  if (currencyJson.dexShare) {
    const [tokenA, tokenB] = currencyJson.dexShare;
    return `${tokenA.token}<>${tokenB.token} LP`;
  }

  return '??';
}

function convertTime(fullDate: Date): number {
  // Converts unix time to 'YYYYMMDD'
  let dateObj = {}
  dateObj['year'] = fullDate.getFullYear().toString();
  dateObj['month'] = (fullDate.getMonth() + 1).toString();  // getMonth is zero-indexed
  dateObj['day'] = fullDate.getDate().toString();

  for (const dateProperty in dateObj) {
    if (dateObj[dateProperty].length == 1) {
      dateObj[dateProperty] = '0' + dateObj[dateProperty];
    }
  }
  
  let dateOut = dateObj['year'] + dateObj['month'] + dateObj['day'];

  return parseInt(dateOut);
}

async function handleAccountEvent(event: SubstrateEvent): Promise<void> {
  // convert events
  const { 
    event: {
      data: [currency, from, to, amount],
    },
  } = event;

  const transferId = `${event.block.block.header.number.toNumber()}-${event.idx}`
  const transferTime = BigInt(event.extrinsic.block.timestamp.getTime());

  let [currencyFrom, currencyTo] = getTransferToken(currency);

  let fromAccount = await getAccount(from.toString());
  let toAccount = await getAccount(to.toString());

  let fromAccountBalance = await getAccountBalance(from.toString(), currencyFrom);
  let toAccountBalance = await getAccountBalance(to.toString(), currencyTo);

  await updateBalance(fromAccountBalance, 'from', amount.toString(), transferId, transferTime);
  await updateBalance(toAccountBalance, 'to', amount.toString(), transferId, transferTime);

  await fromAccount.save();
  await toAccount.save();
}

async function handleLiquidityEvent(event: SubstrateEvent, add_remove: string): Promise<void> {
  // convert event 
  const {
    event: {
      data: [accountId, token0, token0Amt, token1, token1Amt, shareIncrement],
    },
  } = event;
  // convert event time to 'YYYYMMDD'
  const eventTime = BigInt(event.extrinsic.block.timestamp.getTime());
  const eventTimeDate = new Date(Number(eventTime));
  const eventTimeInt = convertTime(eventTimeDate);
  // parse token values
  const token0Parse = getLiquidityToken(token0);
  const token1Parse = getLiquidityToken(token1);
  // return daily pool level for gieven tokens and update
  // let dailyPool = await getDailyPool(token0Parse, token1Parse, eventTimeInt.toString());
  let dailyPool = await getDailyPool(token0Parse, token1Parse, eventTimeInt.toString());
  await updateDailyPool(dailyPool, token0Amt.toString(), token1Amt.toString(), add_remove);

  return 
}

export async function handleEvent(event: SubstrateEvent): Promise<void> {
  if (event.event.section == "currencies" && event.event.method == "Transferred") {
    await handleAccountEvent(event);
  } else if (event.event.section == "dex" && event.event.method == "AddLiquidity") {
    await handleLiquidityEvent(event, 'add');
  } else if (event.event.section == "dex" && event.event.method == "RemoveLiquidity") {
    await handleLiquidityEvent(event, 'remove');
  }
  
  return
}