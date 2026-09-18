import { Injectable } from '@nestjs/common';
import { mnemonicNew, mnemonicToPrivateKey } from '@ton/crypto';
import { WalletContractV4 } from '@ton/ton';
import { Address } from '@ton/ton';

export type CreatedDealWallet = {
  mnemonic: string[];
  publicKeyHex: string;
  secretKeyHex: string;
  address: string;
  addressRaw: Address;
};

function toHex(bytes: Uint8Array) {
  return Buffer.from(bytes).toString('hex');
}

@Injectable()
export class DealWalletFactory {
  async createNewDealWallet(): Promise<CreatedDealWallet> {
    const mnemonic = await mnemonicNew(24);
    const keyPair = await mnemonicToPrivateKey(mnemonic);

    const wallet = WalletContractV4.create({
      workchain: 0,
      publicKey: keyPair.publicKey,
    });

    return {
      mnemonic,
      publicKeyHex: toHex(keyPair.publicKey),
      secretKeyHex: toHex(keyPair.secretKey),
      address: wallet.address.toString({ bounceable: false }),
      addressRaw: wallet.address,
    };
  }
}
