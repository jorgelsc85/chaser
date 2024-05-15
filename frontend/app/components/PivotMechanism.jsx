import React, { useEffect, useMemo, useState } from 'react';
import { ethers, parseEther, solidityPackedKeccak256 } from 'ethers';
import PoolABI from '../ABI/PoolABI.json'; // Adjust the path as needed
import WethABI from '../ABI/WethABI.json'; // Adjust the path as needed
import networks from '../JSON/networks.json'
import protocolHashes from '../JSON/protocolHashes.json'
import contractAddresses from '../JSON/contractAddresses.json'
import PivotPopup from './PivotPopup.jsx';
import { decodeAcrossDepositEvent, decodeCCIPSendMessageEvent } from '../utils';


const PivotMechanism = ({ fetchPoolData, poolData, provider, setErrorMessage, txData, setTxData }) => {
    const [targetChain, setTargetChain] = useState('11155111');
    const [protocolName, setProtocolName] = useState("aave-v3")
    const [pivotInitialized, setPivotInitialized] = useState(false);
    const [initialMarket, setInitialMarket] = useState("0x29598b72eb5CeBd806C5dCD549490FdA35B13cD8")
    const [pivotTx, setPivotTx] = useState("")
    useEffect(() => {
        if ((poolData?.openAssertion && poolData?.openAssertion !== "0x0000000000000000000000000000000000000000000000000000000000000000") || poolData?.isPivoting) {
            setPivotInitialized(true)
        }
    }, [poolData])

    const windowOverride = useMemo(() => (
        typeof window !== 'undefined' ? window : null
    ), []);

    const executePivot = async () => {
        let signer = null;
        try {
            await provider.send("eth_requestAccounts", []);
            signer = await provider.getSigner();
        } catch (err) {
            console.log("Connection Error: " + err?.info?.error?.message ?? err?.message);
        }

        const pool = new ethers.Contract(poolData.address || "0x0", PoolABI, signer)
        try {

            const tx = await (await pool.sendPositionChange(
                initialMarket,
                protocolName,
                targetChain,
                { gasLimit: 3000000 }
            )).wait()

            let eventData = {}
            if (networks[poolData?.currentChain] !== 'sepolia') {
                eventData = await decodeCCIPSendMessageEvent(tx.logs)
            } else if (networks[targetChain] !== 'sepolia') {
                eventData = await decodeAcrossDepositEvent(tx.logs)
            }
            setPivotTx(tx.hash)

        } catch (err) {
            console.log('HIT?', err?.hash, err?.error, err)
            setErrorMessage(err?.info?.error?.message ?? "This transaction has failed\n\n" + (err?.receipt ? "TX: " + err.receipt.hash : ""))
        }
        setPivotInitialized(false)
    }

    const openProposal = async () => {
        let signer = null;
        try {
            await provider.send("eth_requestAccounts", []);
            signer = await provider.getSigner();
        } catch (err) {
            console.log("Connection Error: " + err?.info?.error?.message ?? err?.message);
        }

        const pool = new ethers.Contract(poolData.address || "0x0", PoolABI, signer)
        try {
            //User approve USDC bond
            //call query move position on the pool
            const USDC = new ethers.Contract("0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" || "0x0", WethABI, signer)
            await (await USDC.approve(contractAddresses.sepolia["arbitrationContract"], 500000)).wait()

            const queryTx = (await (await pool.queryMovePosition(protocolName, initialMarket, targetChain, { gasLimit: 7000000 })).wait()).hash

            fetchPoolData()

        } catch (err) {
            console.log('HIT?', err?.hash, err?.error, err)
            setErrorMessage(err?.info?.error?.message ?? "This transaction has failed\n\n" + (err?.receipt ? "TX: " + err.receipt.hash : ""))
        }
        setPivotInitialized(false)
    }


    let pivotPopup = null
    if (pivotInitialized || pivotTx) {
        pivotPopup = <PivotPopup isPivoting={poolData?.isPivoting} pivotTx={pivotTx} poolData={poolData} tvl={poolData?.TVL} provider={provider} fetchPoolData={fetchPoolData} poolAddress={poolData.address} pivotTarget={protocolName + " " + networks[targetChain]} openAssertion={poolData?.openAssertion} closePopup={() => {
            setPivotInitialized(false)
            setPivotTx("")
        }} openProposal={() => openProposal()} executePivot={() => executePivot()} />
    }

    return (
        <div className="interactionSection">
            {pivotPopup}
            <div>
                <span className="">Pivot Position</span>
                <div style={{ padding: 0 }} className="new-pool-inputs">
                    <select style={{ marginTop: 0, marginBottom: "10px" }} onChange={(x) => {
                        setTargetChain(x.target.value)
                        let marketIdKey = ""
                        if (protocolName == 'aave-v3') {
                            marketIdKey = "aaveMarketId"
                        }
                        if (protocolName == 'compound-v3') {
                            marketIdKey = "compoundMarketId"
                        }
                        const networkKey = networks[x.target.value]
                        setInitialMarket(contractAddresses[networkKey][marketIdKey])
                    }} value={targetChain} >
                        {Object.keys(networks).map(network => (
                            <option key={networks[network]} value={network}>{networks[network]}</option>
                        ))}
                    </select>
                </div>
                <div style={{ padding: 0 }} className="new-pool-inputs">

                    <select style={{ marginTop: 0, marginBottom: "10px" }} onChange={(x) => {
                        setProtocolName(x.target.value)

                        let marketIdKey = ""
                        if (x.target.value == 'aave-v3') {
                            marketIdKey = "aaveMarketId"
                        }
                        if (x.target.value == 'compound-v3') {
                            marketIdKey = "compoundMarketId"
                        }
                        const networkKey = networks[targetChain]
                        setInitialMarket(contractAddresses[networkKey][marketIdKey])
                    }} value={protocolName} >
                        {Object.values(protocolHashes).map(protocol => (
                            <option key={protocol} value={protocol}>{protocol}</option>
                        ))}
                    </select>
                    <input
                        style={{ marginTop: "0" }}
                        type="text"
                        placeholder="0x0"
                        className="new-pool-inputs"
                        value={initialMarket}
                        disabled
                        onChange={(x) => {
                            setInitialMarket(x.target.value)
                        }}
                    />
                </div>

            </div>
            <button className="button" onClick={() => {

                if (!networks[targetChain]) {
                    setErrorMessage("The chain you have entered is not supported at this time.")
                    return
                }
                if (!Object.values(protocolHashes)?.includes(protocolName)) {
                    setErrorMessage("The protocol you have entered is not supported at this time.")
                    return
                }
                setPivotInitialized(true)

            }}>Send Pivot</button>
        </div>
    );
};

export default PivotMechanism;