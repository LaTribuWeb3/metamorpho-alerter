import { Contract, Interface, JsonRpcProvider } from 'ethers';
import dotenv from 'dotenv';
import { metamorphoAbi } from './abis/MetaMorphoAbi';
import { EventQueue } from './EventQueue';
dotenv.config();

const RPC_URL: string | undefined = process.env.RPC_URL;
const METAMORPHO_ADDRESS: string | undefined = process.env.METAMORPHO_ADDRESS;

function startListening() {
  if (!METAMORPHO_ADDRESS) {
    throw new Error('No METAMORPHO_ADDRESS found in env');
  }
  console.log('Started the event listener');
  const web3Provider = new JsonRpcProvider(RPC_URL, undefined, { staticNetwork: true, pollingInterval: 15_000 });
  const metamorphoContract = new Contract(METAMORPHO_ADDRESS, metamorphoAbi, web3Provider);

  const iface = new Interface(metamorphoAbi);

  metamorphoContract.removeAllListeners();

  metamorphoContract.on('*', (event) => {
    // The `event.log` has the entire EventLog
    const parsed = iface.parseLog(event.log);

    if (!parsed) {
      console.log('Could not parse event', { event });
      return;
    }

    EventQueue.push({
      txHash: event.log.transactionHash,
      eventName: parsed.name,
      eventArgs: parsed.args.map((_) => _.toString()),
      block: event.log.blockNumber,
      originArgs: parsed.args
    });
  });
}

startListening();
