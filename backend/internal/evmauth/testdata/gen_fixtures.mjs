// Builds the contract-signer fixtures of internal/evmauth on an anvil fork.
// Keys are anvil's public test mnemonic: nothing here has value.
//
//   anvil --fork-url https://sepolia.base.org --fork-block-number 47800000 --port 8545
//   (in a scratch dir) npm i viem@2.57.3
//   RPC=http://127.0.0.1:8545 CHAIN=base-sepolia FORK_BLOCK=47800000 node gen_fixtures.mjs > basesepolia_fixtures.json
//
// Base mainnet: --fork-url https://mainnet.base.org --fork-block-number 52289000, CHAIN=base,
// FORK_BLOCK=52289000, output base_fixtures.json. Then record the RPC answers (see fork_test.go).
import { createPublicClient, createWalletClient, http, hashMessage, encodeFunctionData, encodeAbiParameters, getAddress, parseAbi, zeroAddress, concat } from 'viem'
import { mnemonicToAccount } from 'viem/accounts'
import { base, baseSepolia } from 'viem/chains'
import { toCoinbaseSmartAccount } from 'viem/account-abstraction'
import { createSiweMessage } from 'viem/siwe'
import { parseErc6492Signature } from 'viem/utils'
const rpc = process.env.RPC
const chain = process.env.CHAIN === 'base' ? base : baseSepolia
const forkBlock = Number(process.env.FORK_BLOCK)
const M = 'test test test test test test test test test test test junk'
const acct = (i) => mnemonicToAccount(M, { addressIndex: i })
const pub = createPublicClient({ chain, transport: http(rpc) })
const wal = createWalletClient({ chain, transport: http(rpc), account: acct(0) })
const FACTORY = '0x14F2982D601c9458F93bd70B218933A6f8165e7b', SAFE_L2 = '0xEdd160fEBBD92E350D4D398fb636302fccd67C7e', HANDLER = '0x3EfCBb83A4A7AfcB4F68D501E2c2203a38be77f4'
const safeAbi = parseAbi(['function setup(address[],uint256,address,bytes,address,address,uint256,address)', 'function getMessageHashForSafe(address,bytes) view returns (bytes32)', 'function getOwners() view returns (address[])', 'function getThreshold() view returns (uint256)'])
const factoryAbi = parseAbi(['function createProxyWithNonce(address,bytes,uint256) returns (address)'])
const owners = [acct(1), acct(2), acct(3)]
const init = encodeFunctionData({ abi: safeAbi, functionName: 'setup', args: [owners.map(o => o.address), 2n, zeroAddress, '0x', HANDLER, zeroAddress, 0n, zeroAddress] })
const { result: safe } = await pub.simulateContract({ address: FACTORY, abi: factoryAbi, functionName: 'createProxyWithNonce', args: [SAFE_L2, init, 20261007n], account: acct(0) })
await pub.waitForTransactionReceipt({ hash: await wal.writeContract({ address: FACTORY, abi: factoryAbi, functionName: 'createProxyWithNonce', args: [SAFE_L2, init, 20261007n] }) })
const siwe = (address, nonce) => createSiweMessage({ address, chainId: chain.id, domain: 'memba.club', nonce, uri: 'https://memba.club', version: '1', issuedAt: new Date('2026-10-07T12:00:00.000Z'), expirationTime: new Date('2026-10-07T12:10:00.000Z'), statement: 'Sign in to Memba.' })
const safeMsg = siwe(safe, 'safe0000000000000000000000000001')
const safeHash = hashMessage(safeMsg)
const safeMsgHash = await pub.readContract({ address: safe, abi: safeAbi, functionName: 'getMessageHashForSafe', args: [safe, encodeAbiParameters([{ type: 'bytes32' }], [safeHash])] })
const sorted = [owners[0], owners[1]].sort((a, b) => a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1)
const safeSig = concat(await Promise.all(sorted.map(o => o.sign({ hash: safeMsgHash }))))
const oneSig = await sorted[0].sign({ hash: safeMsgHash })
// Coinbase Smart Wallet v1, one EOA owner, never deployed.
const csw = await toCoinbaseSmartAccount({ client: pub, owners: [acct(4)], version: '1' })
const cswAddr = await csw.getAddress()
const cswMsg = siwe(cswAddr, 'csw00000000000000000000000000001')
const { factory } = await csw.getFactoryArgs()
// viem wraps a signature of an undeployed account in ERC-6492 itself, as Base
// Account and other smart wallets do: this is the signature a client submits.
const signature6492 = await csw.signMessage({ message: cswMsg })
const { signature: inner } = parseErc6492Signature(signature6492)
const otherMessageSignature6492 = await csw.signMessage({ message: siwe(cswAddr, 'csw00000000000000000000000000002') })
console.log(JSON.stringify({
  chainId: chain.id, forkBlock, note: `anvil fork of ${chain.name}; signer keys are the public anvil test mnemonic`,
  safe: { address: getAddress(safe), version: 'SafeL2 1.5.0', threshold: Number(await pub.readContract({ address: safe, abi: safeAbi, functionName: 'getThreshold' })), message: safeMsg, hash: safeHash, signature: safeSig, oneOwnerSignature: oneSig },
  coinbaseSmartWallet: { address: cswAddr, deployed: (await pub.getCode({ address: cswAddr })) !== undefined, factory, message: cswMsg, hash: hashMessage(cswMsg), signature6492, innerSignature: inner, otherMessageSignature6492 },
}, null, 1))
