import { mnemonicNew } from '@ton/crypto';
import { mnemonicToWalletKey } from '@ton/crypto';
import { WalletContractV4 } from '@ton/ton';

async function main() {
  const mnemonic = await mnemonicNew(24);

  const keyPair = await mnemonicToWalletKey(mnemonic);

  const wallet = WalletContractV4.create({
    workchain: 0,
    publicKey: keyPair.publicKey,
  });

  console.log('MNEMONIC:');
  console.log(mnemonic.join(' '));

  console.log('\nADDRESS:');
  console.log(wallet.address);
}

main();
