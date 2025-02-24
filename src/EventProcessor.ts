import { EventData, EventQueue } from './EventQueue';
import { FriendlyFormatNumber, loadMarketData, MarketData, norm, saveMarketData, sleep } from './Utils';
import { SendTelegramMessage } from './TelegramHelper';
import { ethers } from 'ethers';
import { morphoBlueAbi } from './abis/MorphoBlueAbi';
import { erc20Abi } from './abis/ERC20Abi';

const TG_BOT_ID: string | undefined = process.env.TG_BOT_ID;
const TG_CHAT_ID: string | undefined = process.env.TG_CHAT_ID;
const TG_CHAT_REALLOCATION_ID: string | undefined = process.env.TG_CHAT_REALLOCATION_ID;
const METAMORPHO_NAME: string | undefined = process.env.METAMORPHO_NAME;
const EXPLORER_URI: string | undefined = process.env.EXPLORER_URI;
const ASSET_DECIMALS: string | undefined = process.env.ASSET_DECIMALS;
const ASSET: string | undefined = process.env.ASSET;

let allMarketData: { [id: string]: MarketData } = {};

async function startEventProcessor() {
  console.log('Started the event processor');

  allMarketData = loadMarketData();
  console.log('Loaded market data', allMarketData);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (EventQueue.length > 0) {
      const event = EventQueue.shift();
      if (event) {
        await ProcessAsync(event);
      }
    } else {
      await sleep(1000);
    }
  }
}

async function ProcessAsync(event: EventData) {
  if (!TG_BOT_ID) {
    throw new Error('No TG_BOT_ID found in env');
  }

  if (!TG_CHAT_ID) {
    throw new Error('No TG_BOT_ID found in env');
  }

  console.log(`NEW EVENT DETECTED AT BLOCK ${event.block}: ${event.eventName}`, { args: event.eventArgs });
  if (process.env.FILTER_AUTHOR && process.env.FILTER_AUTHOR.toLowerCase() == 'true') {
    if (
      event.eventName.toLowerCase() === 'reallocatewithdraw' ||
      event.eventName.toLowerCase() === 'reallocatesupply'
    ) {
      const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
      const transaction = await provider.getTransaction(event.txHash);
      if (
        transaction &&
        transaction.from.toLowerCase() === '0xF404dBb34f7F16BfA315daaA9a8C33c7aBe94eD1'.toLowerCase()
      ) {
        console.log(`Ignoring event - ${event.eventName} - from address 0xF404dBb34f7F16BfA315daaA9a8C33c7aBe94eD1`);
        return;
      }
    }
  }
  const msgToSend: string | undefined = await buildMessageFromEvent(event);
  if (!msgToSend) {
    console.log('Nothing to send to TG');
  } else {
    if (
      (event.eventName.toLowerCase() === 'reallocatesupply' ||
        event.eventName.toLowerCase() === 'reallocatewithdraw') &&
      TG_CHAT_REALLOCATION_ID
    ) {
      await SendTelegramMessage(TG_CHAT_REALLOCATION_ID, TG_BOT_ID, msgToSend, false);
    } else {
      await SendTelegramMessage(TG_CHAT_ID, TG_BOT_ID, msgToSend, false);
    }
  }
}

async function buildMessageFromEvent(event: EventData): Promise<string | undefined> {
  switch (event.eventName.toLowerCase()) {
    default:
      return `${buildMsgHeader(event)}\n` + event.eventArgs.join('\n');
    case 'updatelasttotalassets':
    case 'accrueinterest':
    case 'accruefee':
    case 'createmetamorpho':
    case 'transfer':
    case 'approval':
      // user facing events, no need for an alert
      return undefined;
    case 'deposit': {
      // event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares);
      const assetThreshold = process.env.ASSET_THRESHOLD;
      if (!assetThreshold) {
        console.log('ASSET_THRESHOLD not set, ignoring event');
        return undefined;
      }

      if (BigInt(event.eventArgs[2]) >= BigInt(assetThreshold)) {
        let amountNormalized = '';
        if (ASSET_DECIMALS && ASSET) {
          amountNormalized = `[${FriendlyFormatNumber(norm(event.eventArgs[2], Number(ASSET_DECIMALS)))} ${ASSET}]`;
        }
        return (
          `${buildMsgHeader(event, amountNormalized)}\n` +
          `sender: ${event.eventArgs[0]}\n` +
          `owner: ${event.eventArgs[1]}\n` +
          `asset: ${event.eventArgs[2]}\n` +
          `shares: ${event.eventArgs[3]}\n`
        );
      } else {
        console.log(`Ignoring deposit event because assets < threshold. ${event.eventArgs[2]} < ${assetThreshold}`);
        return undefined;
      }
    }
    case 'withdraw': {
      // event Withdraw(address indexed sender,address indexed receiver,address indexed owner,uint256 assets,uint256 shares);
      const assetThreshold = process.env.ASSET_THRESHOLD;
      if (!assetThreshold) {
        console.log('ASSET_THRESHOLD not set, ignoring event');
        return undefined;
      }

      if (BigInt(event.eventArgs[3]) >= BigInt(assetThreshold)) {
        let amountNormalized = '';
        if (ASSET_DECIMALS && ASSET) {
          amountNormalized = `[${FriendlyFormatNumber(norm(event.eventArgs[3], Number(ASSET_DECIMALS)))} ${ASSET}]`;
        }

        return (
          `${buildMsgHeader(event, amountNormalized)}\n` +
          `sender: ${event.eventArgs[0]}\n` +
          `receiver: ${event.eventArgs[1]}\n` +
          `owner: ${event.eventArgs[2]}\n` +
          `assets: ${event.eventArgs[3]}\n` +
          `shares: ${event.eventArgs[4]}\n`
        );
      } else {
        console.log(`Ignoring withdraw event because assets < threshold. ${event.eventArgs[3]} < ${assetThreshold}`);
        return undefined;
      }
    }
    case 'submittimelock':
      // event SubmitTimelock(uint256 newTimelock);
      return `${buildMsgHeader(event)}\n` + `newTimelock: ${event.eventArgs[0]}\n`;
    case 'settimelock':
      // event SetTimelock(address indexed caller, uint256 newTimelock);
      return `${buildMsgHeader(event)}\n` + `caller: ${event.eventArgs[0]}\n` + `newTimelock: ${event.eventArgs[1]}\n`;
    case 'setskimrecipient':
      // event SetSkimRecipient(address indexed newSkimRecipient);
      return `${buildMsgHeader(event)}\n` + `newSkimRecipient: ${event.eventArgs[0]}\n`;
    case 'setfee':
      // event SetFee(address indexed caller, uint256 newFee);
      return `${buildMsgHeader(event)}\n` + `caller: ${event.eventArgs[0]}\n` + `newFee: ${event.eventArgs[1]}\n`;
    case 'setfeerecipient':
      // event SetFeeRecipient(address indexed newFeeRecipient);
      return `${buildMsgHeader(event)}\n` + `newFeeRecipient: ${event.eventArgs[0]}\n`;
    case 'submitguardian':
      // event SubmitGuardian(address indexed newGuardian);
      return `${buildMsgHeader(event)}\n` + `newGuardian: ${event.eventArgs[0]}\n`;
    case 'setguardian':
      // event SetGuardian(address indexed caller, address indexed guardian);
      return `${buildMsgHeader(event)}\n` + `caller: ${event.eventArgs[0]}\n` + `guardian: ${event.eventArgs[1]}\n`;
    case 'submitcap':
      // event SubmitCap(address indexed caller, Id indexed id, uint256 cap);
      return (
        `${buildMsgHeader(event)}\n` +
        `caller: ${event.eventArgs[0]}\n` +
        `id: ${event.eventArgs[1]} ${await getMarketDataLabel(event.eventArgs[1] as string)}\n` +
        `cap: ${event.eventArgs[2]}\n`
      );

    case 'setcap':
      // event SetCap(address indexed caller, Id indexed id, uint256 cap);
      return (
        `${buildMsgHeader(event)}\n` +
        `caller: ${event.eventArgs[0]}\n` +
        `id: ${event.eventArgs[1]} ${await getMarketDataLabel(event.eventArgs[1] as string)}\n` +
        `cap: ${event.eventArgs[2]}\n`
      );

    case 'submitmarketremoval':
      // event SubmitMarketRemoval(address indexed caller, Id indexed id);
      return (
        `${buildMsgHeader(event)}\n` +
        `caller: ${event.eventArgs[0]}\n` +
        `id: ${event.eventArgs[1]} ${await getMarketDataLabel(event.eventArgs[1] as string)}\n`
      );

    case 'setcurator':
      // event SetCurator(address indexed newCurator);
      return `${buildMsgHeader(event)}\n` + `newCurator: ${event.eventArgs[0]}\n`;

    case 'setisallocator':
      // event SetIsAllocator(address indexed allocator, bool isAllocator);
      return (
        `${buildMsgHeader(event)}\n` + `allocator: ${event.eventArgs[0]}\n` + `isAllocator: ${event.eventArgs[1]}\n`
      );

    case 'revokependingtimelock':
      // event RevokePendingTimelock(address indexed caller);
      return `${buildMsgHeader(event)}\n` + `caller: ${event.eventArgs[0]}\n`;

    case 'revokependingcap':
      // event RevokePendingCap(address indexed caller, Id indexed id);
      return (
        `${buildMsgHeader(event)}\n` +
        `caller: ${event.eventArgs[0]}\n` +
        `id: ${event.eventArgs[1]} ${await getMarketDataLabel(event.eventArgs[1] as string)}\n`
      );

    case 'revokependingguardian':
      // event RevokePendingGuardian(address indexed caller);
      return `${buildMsgHeader(event)}\n` + `caller: ${event.eventArgs[0]}\n`;

    case 'revokependingmarketremoval':
      // event RevokePendingMarketRemoval(address indexed caller, Id indexed id);
      return (
        `${buildMsgHeader(event)}\n` +
        `caller: ${event.eventArgs[0]}\n` +
        `id: ${event.eventArgs[1]} ${await getMarketDataLabel(event.eventArgs[1] as string)}\n`
      );

    case 'setsupplyqueue': {
      // event SetSupplyQueue(address indexed caller, Id[] newSupplyQueue);
      const supplyQueuesStr: string[] = [];
      for (const id of event.originArgs[1]) {
        supplyQueuesStr.push(`${id} ${await getMarketDataLabel(id as string)}`);
      }

      return (
        `${buildMsgHeader(event)}\n` +
        `caller: ${event.eventArgs[0]}\n` +
        `newSupplyQueue:\n${supplyQueuesStr.join('\n')}\n`
      );
    }

    case 'setwithdrawqueue': {
      // event SetWithdrawQueue(address indexed caller, Id[] newWithdrawQueue);
      const withdrawQueuesStr: string[] = [];
      for (const id of event.originArgs[1]) {
        withdrawQueuesStr.push(`${id} ${await getMarketDataLabel(id as string)}`);
      }

      return (
        `${buildMsgHeader(event)}\n` +
        `caller: ${event.eventArgs[0]}\n` +
        `newWithdrawQueue:\n${withdrawQueuesStr.join('\n')}\n`
      );
    }
    case 'reallocatesupply': {
      await getMarketDataLabel(event.eventArgs[1] as string);
      // event ReallocateSupply(address indexed caller, Id indexed id, uint256 suppliedAssets, uint256 suppliedShares);

      let amountNormalized = '';
      if (ASSET_DECIMALS && ASSET) {
        amountNormalized = `[${FriendlyFormatNumber(norm(event.eventArgs[2], Number(ASSET_DECIMALS)))} ${ASSET}]`;
      }

      return (
        `${buildMsgHeader(event, amountNormalized)}\n` +
        `id: ${await getMarketDataLabel(event.eventArgs[1] as string)}\n`
      );
    }
    case 'reallocatewithdraw': {
      await getMarketDataLabel(event.eventArgs[1] as string);
      // event ReallocateWithdraw(address indexed caller, Id indexed id, uint256 withdrawnAssets, uint256 withdrawnShares);
      let amountNormalized = '';
      if (ASSET_DECIMALS && ASSET) {
        amountNormalized = `[${FriendlyFormatNumber(norm(event.eventArgs[2], Number(ASSET_DECIMALS)))} ${ASSET}]`;
      }

      return (
        `${buildMsgHeader(event, amountNormalized)}\n` +
        `id: ${await getMarketDataLabel(event.eventArgs[1] as string)}\n`
      );
    }
    case 'skim':
      // event Skim(address indexed caller, address indexed token, uint256 amount);
      return (
        `${buildMsgHeader(event)}\n` +
        `caller: ${event.eventArgs[0]}\n` +
        `token: ${event.eventArgs[1]}\n` +
        `amount: ${event.eventArgs[2]}\n`
      );
  }
}

async function getMarketDataLabel(marketId: string) {
  try {
    if (!allMarketData[marketId]) {
      console.log(`No market data for id ${marketId}, fetching from onchain-data`);
      const marketData = await fetchMarketData(marketId);
      allMarketData[marketId] = marketData;
      saveMarketData(allMarketData);
    }

    let marketDataLabel = '';
    if (allMarketData[marketId]) {
      marketDataLabel = `[${allMarketData[marketId].collateralSymbol}/${allMarketData[marketId].debtSymbol}/${
        allMarketData[marketId].lltv * 100
      }%]`;
    }
    return marketDataLabel;
  } catch (e) {
    console.log(`Error getting market data label for ${marketId}: ${e}`);
    return '';
  }
}

async function fetchMarketData(marketId: string): Promise<MarketData> {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const morphoBlueContract = new ethers.Contract('0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb', morphoBlueAbi, provider);
  const marketParams = await morphoBlueContract.idToMarketParams(marketId);

  /*  loanToken   address :  0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
  collateralToken   address :  0xA663B02CF0a4b149d2aD41910CB81e23e1c41c32
  oracle   address :  0xd8361b98590293d9A45DdeFC831F077BbBD320CC
  irm   address :  0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC
  lltv   uint256 :  860000000000000000
*/
  const debtAddress = marketParams[0];
  const collateralAddress = marketParams[1];
  const lltv = Number(ethers.formatEther(marketParams[4]));

  let debtSymbol = '';
  try {
    debtSymbol = await getTokenSymbol(debtAddress, provider);
  } catch (e) {
    debtSymbol = 'undefined';
    console.log(`Error getting debt symbol for ${debtAddress}: ${e}`);
  }

  let collateralSymbol = '';
  try {
    collateralSymbol = await getTokenSymbol(collateralAddress, provider);
  } catch (e) {
    collateralSymbol = 'undefined';
    console.log(`Error getting collateral symbol for ${collateralAddress}: ${e}`);
  }

  return {
    id: marketId,
    collateralAddress,
    collateralSymbol,
    debtAddress,
    debtSymbol,
    lltv
  };
}

async function getTokenSymbol(tokenAddress: string, provider: ethers.JsonRpcProvider): Promise<string> {
  ///if token address === maker return MKR
  if (tokenAddress === '0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2') {
    return 'MKR';
  }
  const contract = new ethers.Contract(tokenAddress, erc20Abi, provider);
  const symbol = await contract.symbol();
  return symbol;
}

function buildMsgHeader(event: EventData, headerAddMsg = ''): string {
  return `[${METAMORPHO_NAME}] [${event.eventName}] ${headerAddMsg}\n` + `tx: ${buildTxUrl(event.txHash)}\n`;
}

function buildTxUrl(txhash: string): string {
  return `${EXPLORER_URI}/tx/${txhash}`;
}

startEventProcessor();
