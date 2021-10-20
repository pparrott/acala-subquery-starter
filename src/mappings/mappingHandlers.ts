import { SubstrateEvent } from "@subql/types";
import { Codec } from "@polkadot/types/types";
import { AccountBalance, Account, CurrencyTransfer } from "../types";
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

async function update_balance(accountBalance: AccountBalance, to_from: string, amount: string, transferId: string, transferTime: bigint): Promise<void> {
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

function getToken(currencyId: Codec): string[] {
  const currencyJson = JSON.parse(currencyId.toString());

  if (currencyJson.token) return [currencyJson.token, currencyJson.token];
  if (currencyJson.dexShare) {
    const [tokenA, tokenB] = currencyJson.dexShare;
    return [tokenA, tokenB];
  }

  return [];
}

function convertTime(fullDate: Date): number {
  // Converts unix time to 'YYYYMMDD'
  let dateObj = {}
  dateObj['year'] = fullDate.getFullYear().toString();
  dateObj['month'] = fullDate.getMonth().toString();
  dateObj['day'] = fullDate.getDate().toString();

  for (const dateProperty in dateObj) {
    if (dateObj[dateProperty].length == 1) {
      dateObj[dateProperty] = '0' + dateObj[dateProperty];
    }
  }
  
  let dateOut = dateObj['year'] + dateObj['month'] + dateObj['day']

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

  let [currencyFrom, currencyTo] = getToken(currency);

  let fromAccount = await getAccount(from.toString());
  let toAccount = await getAccount(to.toString());

  let fromAccountBalance = await getAccountBalance(from.toString(), currencyFrom);
  let toAccountBalance = await getAccountBalance(to.toString(), currencyTo);

  await update_balance(fromAccountBalance, 'from', amount.toString(), transferId, transferTime);
  await update_balance(toAccountBalance, 'to', amount.toString(), transferId, transferTime);

  await fromAccount.save();
  await toAccount.save();
}

async function handleLiquidityEvent(event: SubstrateEvent, add_remove: string): Promise<void> {
  // convert event 
  const {
    event: {
      data: [accountId, tokenA, incrementA, tokenB, incrementB],
    },
  } = event;
  
  const eventTime = BigInt(event.extrinsic.block.timestamp.getTime());
  const eventTimeDate = new Date(String(eventTime));
  const eventTimeInt = convertTime(eventTimeDate);

  const liquidityId = `${event.block.block.header.number.toNumber()}-${event.idx}`;

  //
  
  return 
}

export async function handleEvent(event: SubstrateEvent): Promise<void> {
  if (event.event.section == "currencies" && event.event.method == "Transferred") {
    await handleAccountEvent(event);
  } else if (event.event.section == "dex" && event.event.method == "AddLiquidityEvent") {
    await handleLiquidityEvent(event, 'add');
  } else if (event.event.section == "dex" && event.event.method == "RemoveLiquidityEvent") {
    await handleLiquidityEvent(event, 'remove');
  }
  
  return
}

api.query.system.account('5F98oWfz2r5rcRVnP9VCndg33DAAsky3iuoBSpaPUbgN9AJn');