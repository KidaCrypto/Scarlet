import { useState, useCallback, useEffect, FC, useMemo, useRef } from 'react';
import './App.css';
import { cloneObj, ellipsizeThis, getAddressSOLBalance, getAdminAccount, getAdminAccountSecretKey, getCustomNode, getPendingTasks, getRPCEndpoint, getRecentTasks, getTokenDetails, getUserTokens, removePassword, setCustomNode, setPassword, setPendingTasks, shortenNumber, toLocaleDecimal, setRecentTasks, getRetryCount, setRetryCount } from './utils/common';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import axios from 'axios';
import { SOL_ADDRESS, SOL_DECIMALS } from './constants';
import { addPriorityFeeToTransaction, getQuote, swap } from './utils/jupiter';
import { v4 } from 'uuid';
import moment from 'moment';
import { CheckCircleFilled } from '@ant-design/icons';
import { getCloseEmptyAccountTxs } from './utils/wallet';

const SAFE_RENT_VALUE = 0.006;

export type BirdeyeResult = {
  [address: string]: {
      value: number;
      updateUnixTime: number;
      updateHumanTime: string;
      priceChange24h: number;
  }
}

export type MintData = {
  [mintAddress: string]: {
      amount: number;
      decimals: number;
      ata: string;
  }
};

export type AddressMintData = {
  [address: string]: MintData;
}

export type AddressSOLBalance = {
  [address: string]: number;
}

type Props = {
  onBackClick?: () => void;
  headerRight?: JSX.Element;
  children: React.ReactNode;
}
const Veil: FC<Props> = ({ children, onBackClick, headerRight }) => {
  return (
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 100, background: '#282c34', overflow: 'auto' }}>
      {
        onBackClick &&
        <div style={{display: 'flex', width: '100%', marginTop: 10, justifyContent: 'space-between', alignItems: 'center'}}>
          <button style={{ marginLeft: 10 }} onClick={onBackClick}>Back</button>
          {
            headerRight
          }
        </div>
      }
      { children }
    </div>
  );
}

type TokenProps = {
  tokenAddress: string;
  currentAmount: number;
  boughtAmount: number;
  soldAmount: number;
  tokenPrice: number;
  tokenPriceChange: number;
  avgBuyPrice: number;
  avgSellPrice: number;
  selected: boolean;
}
const Token: FC<TokenProps> = ({ tokenAddress, currentAmount, boughtAmount, soldAmount, tokenPrice, tokenPriceChange, avgBuyPrice, avgSellPrice, selected }) => {
  const capital = useMemo(() => {
    return boughtAmount * avgBuyPrice;
  }, [boughtAmount, avgBuyPrice]);

  const soldValue = useMemo(() => {
    return soldAmount * avgSellPrice;
  }, [soldAmount, avgSellPrice]);

  const currentValue = useMemo(() => {
    return currentAmount * tokenPrice;
  }, [currentAmount, tokenPrice]);
  
  const pnl = useMemo(() => {
    return soldValue + currentValue - capital;
  }, [capital, soldValue, currentValue]);

  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', width: '100%', minHeight: 60 }}>
      <div style={{ marginRight: 15 }}>
        <CheckCircleFilled 
          style={{ color: selected? '#00ff7f' : '#6e7270' }}
        />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', width: '100%' }}>
        <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', fontWeight: 'bold', fontSize: 14 }}>
          <a href={`https://solana.fm/address/${tokenAddress}`} target='_blank' rel="noreferrer"><span>{ellipsizeThis(tokenAddress, 5, 5)}</span></a>
          <span>${toLocaleDecimal(currentValue, 2, 2)}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', fontSize: 12 }}>
          <span>{shortenNumber(currentAmount)}</span>
          <span style={{ color: tokenPriceChange < 0? 'orangered' : 'springgreen' }}>{toLocaleDecimal(tokenPriceChange, 2, 2)}%</span>
        </div>
      </div>
    </div>
  );
}

type ProcessedToken = {
  mintAddress: string;
  currentAmount: number;
  tokenPrice: number;
  tokenPriceChange: number;
  currentValue: number;
  decimals: number;
};

type TokenPageProps = {
  show: boolean;
  onBackClick: () => void;
  onCloseEmptyAccountClick: () => void;
  onAddSellTask: (task: Task) => void;
  tokens: ProcessedToken[];
  birdeyeResult?: BirdeyeResult;
  slippageBps: number;
}
const TokenPage: FC<TokenPageProps> = ({ show, onBackClick, tokens, birdeyeResult, slippageBps, onAddSellTask, onCloseEmptyAccountClick }) => {

  const [selectedTokens, setSelectedTokens] = useState<string[]>([]);
  const [pctToSell, setPctToSell] = useState("");
  const [quoteResponses, setQuoteResponses] = useState<{mintAddress: string, quoteResponse: any}[]>([]);

  const SOLPrice = useMemo(() => { return birdeyeResult?.[SOL_ADDRESS]?.value ?? 0 }, [ birdeyeResult ]);
  const quotedPrices = useMemo(() => {
    if(selectedTokens.length === 0) {
      return {
        tokens: [],
        totalValue: 0,
        totalValueSol: 0,
      };
    }

    let tokens: {
      mintAddress: string;
      valueSol: number;
      value: number;
    }[] = [];

    let totalValue = 0;
    let totalValueSol = 0;

    for(const x of selectedTokens) {
      let quoteResponse = quoteResponses.filter(q => q.mintAddress === x)[0];
      let valueSol = quoteResponse && quoteResponse.quoteResponse && quoteResponse.quoteResponse.outAmount? (quoteResponse.quoteResponse.outAmount / SOL_DECIMALS) : 0;
      let value = valueSol * SOLPrice;

      tokens.push({
        mintAddress: x,
        valueSol,
        value,
      });

      totalValue += value;
      totalValueSol += valueSol;
    }

    return {tokens, totalValue, totalValueSol};
  }, [quoteResponses, selectedTokens, SOLPrice]);
  
  const toggleToken = useCallback((mintAddress: string) => {
    let newSelectedTokens = cloneObj<string[]>(selectedTokens);
    if(selectedTokens.includes(mintAddress)) {
      newSelectedTokens = newSelectedTokens.filter(x => x !== mintAddress);
      setSelectedTokens(newSelectedTokens);
      return;
    }
    setSelectedTokens([...newSelectedTokens, mintAddress])
  }, [selectedTokens]);

  const sellSelectedTokens = useCallback(() => {
    if(selectedTokens.length === 0) {
      return;
    }

    if(!pctToSell || Number(pctToSell) === 0) {
      return;
    }

    if(Number(pctToSell) > 100) {
      return;
    }

    selectedTokens.forEach(mintAddress => {
      let token = tokens.filter(y => y.mintAddress === mintAddress)[0];
      let currentAmount = token.currentAmount;
      let amountToSell = currentAmount * Number(pctToSell) / 100;
      if(Number(pctToSell) === 100) {
        amountToSell = currentAmount;
      }

      let task: Task = {
        uuid: v4(),
        type: "sell",
        ca: mintAddress,
        decimals: Math.pow(10, tokens.filter(x => x.mintAddress === mintAddress)[0].decimals),
        amount: amountToSell,
        slippage: slippageBps,
        failed: false,
      }

      setSelectedTokens([]);
      onAddSellTask(task);
    });
  }, [onAddSellTask, selectedTokens, tokens, pctToSell, slippageBps]);

  useEffect(() => {
    if(!pctToSell || Number(pctToSell) === 0) {
      return;
    }
    
    const getQuotes = async() => {
      let quoteResponses = await Promise.all(selectedTokens.map(async x => {
        let token = tokens.filter(y => y.mintAddress === x)[0];
        let currentAmount = token.currentAmount;
        let currentAmountWithoutDecimals = Math.ceil(currentAmount * Math.pow(10, token.decimals));
        let amountToSell = Math.ceil(currentAmountWithoutDecimals * Number(pctToSell) / 100);
        return {
          mintAddress: x,
          quoteResponse: await getQuote(x, amountToSell, slippageBps, "sell"),
        }
      }));

      setQuoteResponses(quoteResponses);
    }

    getQuotes();
  }, [selectedTokens, tokens, slippageBps, pctToSell]);

  if(!show) {
    return null;
  }

  return (
    <Veil 
      onBackClick={onBackClick}
      headerRight={
        <button style={{ fontSize: 12, marginRight: 10, color: 'orangered' }} onClick={onCloseEmptyAccountClick}>Close Empty Accounts</button>
      }
    >
      
      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 15, justifyContent: 'center', alignItems: 'center' }}>
        {
          tokens.map(({ mintAddress, currentAmount, currentValue, tokenPrice, tokenPriceChange }) => {
            return (
              <button key={`token-button-${mintAddress}`} style={{ width: '90%', padding: 0, cursor: currentAmount === 0? 'not-allowed' : 'pointer' }} onClick={() => { toggleToken(mintAddress) }} disabled={currentAmount === 0}>
                <Token
                  key={mintAddress}
                  tokenAddress={mintAddress}
                  currentAmount={currentAmount}
                  boughtAmount={0} // use later
                  soldAmount={0} // use later
                  tokenPrice={tokenPrice}
                  tokenPriceChange={tokenPriceChange}
                  avgBuyPrice={0} // use later
                  avgSellPrice={0} // use later
                  selected={selectedTokens.includes(mintAddress)}
                />
              </button>
            )
          })
        }
        <div style={{ 
          position: 'sticky', 
          bottom: 10, 
          width: '90%', 
          minHeight: 100, 
          padding: 10, 
          borderRadius: 5, 
          background: '#343434',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center'
        }}>
          <input type="number" placeholder='% to sell' value={pctToSell} onChange={({target}) => { setPctToSell(target.value) }}/>
          <span style={{ fontSize: 12, marginTop: 10, marginBottom: 10, }}>Expected Amount of SOL to Receive</span>
          {
            quotedPrices.tokens.map((x) => {
              return (
                <div key={`sale-summary-${x.mintAddress}`} style={{ display: 'flex', justifyContent: 'space-between', width: '90%', fontSize: 12, marginTop: 2 }}>
                  <span>{ellipsizeThis(x.mintAddress, 5, 5)}</span>
                  <span>${toLocaleDecimal(x.value, 3, 3)} ({toLocaleDecimal(x.valueSol, 5, 5)} SOL)</span>
                </div>
              )
            })
          }
          
          <div style={{ display: 'flex', justifyContent: 'space-between', width: '90%', fontSize: 12, marginTop: 12 }}>
            <strong>Total</strong>
            <strong>${toLocaleDecimal(quotedPrices.totalValue, 3, 3)} ({toLocaleDecimal(quotedPrices.totalValueSol, 5, 5)} SOL)</strong>
          </div>

          <button style={{ borderRadius: 5, background: 'orangered', width: '90%', paddingTop: 5, paddingBottom: 5, marginTop: 20 }} onClick={sellSelectedTokens}>Sell {selectedTokens.length} token(s)</button> 
        </div>
      </div>
    </Veil>
  )
}

type SettingsPageProps = {
  show: boolean;
  onBackClick: () => void;
  onLogout: () => void;
}
const SettingsPage: FC<SettingsPageProps> = ({ show, onBackClick, onLogout }) => {
  const [hasCopied, setHasCopied] = useState(false);
  const [pageCustomNode, setPageCustomNode] = useState("");
  const [customRetryCount, setCustomRetryCount] = useState(3);

  const onCopyPrivateKey = useCallback(async() => {
    let secretKey = await getAdminAccountSecretKey();
    navigator.clipboard.writeText(secretKey.toString());
    setHasCopied(true);
    setTimeout(() => {
      setHasCopied(false);
    }, 1000);
  }, []);

  const onLogoutClick = useCallback(async() => {
    await removePassword();
    onLogout();
  }, [ onLogout ]);

  useEffect(() => {
    const getNode = async() => {
      let node = await getCustomNode();
      setPageCustomNode(node);

      let retryCount = await getRetryCount();
      setCustomRetryCount(retryCount);
    }

    getNode();
  }, []);

  const onCustomNodeChange = useCallback(async(newNode: string) => {
    setPageCustomNode(newNode);
    await setCustomNode(newNode);
  }, []);

  const onCustomRetryCountChange = useCallback(async(newRetryCount: string) => {
    let retryCount = Math.round(Number(newRetryCount));
    setCustomRetryCount(retryCount);
    await setRetryCount(retryCount);
  }, []);

  if(!show) {
    return null;
  }

  return (
    <Veil onBackClick={onBackClick}>
      <div style={{ display: 'flex', flexDirection: 'column', height: `calc(100% - 30px)`, justifyContent: 'center', alignItems: 'center' }}>
        <span style={{textAlign: 'start', fontSize: 12, fontWeight: 'bold', marginBottom: 2, marginTop: 15,}}>Retry Count</span>
        <input type="number" placeholder='Retry Count' value={customRetryCount} onChange={async({target}) => { onCustomRetryCountChange(target.value) }} style={{ width: 'calc(90% - 10px)', padding: 5 }}/>
        <span style={{textAlign: 'start', fontSize: 12, fontWeight: 'bold', marginBottom: 2, marginTop: 15,}}>Custom Node</span>
        <input type="text" placeholder='Custom Node' value={pageCustomNode} onChange={async({target}) => { onCustomNodeChange(target.value) }} style={{ width: 'calc(90% - 10px)', padding: 5 }}/>
        {/* <input type="text" placeholder='Withdrawal Address' /> */}
        <button onClick={onCopyPrivateKey} style={{ marginTop: 30, width: '91%', padding: 10, border: '1px solid #ffffff55', borderRadius: 5 }}>
          {hasCopied? 'Copied' : 'Copy Private Key'}
        </button>
        <button onClick={onLogoutClick} style={{ marginTop: 10, width: '91%', padding: 10, border: '1px solid #ffffff55', borderRadius: 5, backgroundColor: 'orangered', color: 'white' }}>
          Log Out
        </button>
        {/* <button style={{ marginTop: 10, width: '90%', padding: 10, border: '1px solid #ffffff55', borderRadius: 5 }}>
          Migrate Tokens To Withdrawal Address
        </button> */}
      </div>
    </Veil>
  )
}
type LoginPageProps = {
  show: boolean;
  onLogin: () => void;
  isPasswordError: boolean;
}
const LoginPage: FC<LoginPageProps> = ({ show, onLogin, isPasswordError }) => {
  const [currentPassword, setCurrentPassword] = useState("");

  const onLoginClick = useCallback(async() => {
    await setPassword(currentPassword);
    onLogin();
  }, [currentPassword, onLogin]);

  if(!show) {
    return null;
  }

  return (
    <Veil>
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        <input type="password" placeholder='Password' value={currentPassword} onChange={({target}) => { setCurrentPassword(target.value) }}/>
        {
          isPasswordError &&
          <span style={{ color: 'orangered', fontSize: 12, marginTop: 2 }}>Wrong Password!</span>
        }
        <button style={{ marginTop: 15, letterSpacing: 5 }} onClick={onLoginClick}>
          -LOGIN-
        </button>
      </div>
    </Veil>
  )
}

type TaskType = "buy" | "sell" | "closeEmpty";
export type Task = {
  uuid: string;
  type: TaskType;
  ca: string;
  amount: number;
  decimals: number;
  slippage: number;
  failed: boolean;
};

export type RecentTask = {
  type: TaskType;
  ca: string;
  amount: number;
  decimals: number;
  txHash: string;
};
type MainProps = {
  onTokenButtonClick: () => void;
  onSettingsButtonClick: () => void;
  onSlippageChanged: (slippage: number) => void;
  onAddBuyTask: (task: Task) => void;
  onRetry: (uuid: string) => void;
  onRemove: (uuid: string) => void;
  keypair: Keypair;
  totalValue: number;
  totalSolValue: number;
  solBalance: number;
  getData: () => void;
  pendingTasks: Task[];
  recentTasks: RecentTask[];
}
const Main: FC<MainProps> = ({
  onTokenButtonClick,
  onSettingsButtonClick,
  keypair,
  totalValue,
  totalSolValue,
  solBalance,
  onSlippageChanged,
  onAddBuyTask,
  pendingTasks,
  recentTasks,
  onRetry,
  onRemove,
  getData,
}) => {

  const [ca, setCA] = useState("");
  const [slippage, setSlippage] = useState("0.5");
  const [customSlippage, setCustomSlippage] = useState("");
  const [solToUse, setSolToUse] = useState("");
  const [hasCopied, setHasCopied] = useState(false);

  const getCA = useCallback(() => {

    chrome.tabs.query({active: true, lastFocusedWindow: true}, tabs => {
        let url = tabs[0].url;
        if(!url) {
          setCA("");
          return;
        }
        let ca = "";
        if(url.includes("dexscreener")) {
          // ca = url.replace("https://dexscreener.com/solana/", "");
          chrome.tabs.sendMessage(tabs[0].id!, {type:"msg_from_popup"}, function(response){
            setCA(response);
          });
          return;
        }

        if(url.includes("birdeye") && url.includes("?chain=solana")) {
          ca = url.replace("https://birdeye.so/token/", "").split("?")[0];
          setCA(ca);
          return;
        }

    });

  }, []);

  const onAddTask = useCallback(() => {
    let task: Task = {
      uuid: v4(),
      type: "buy",
      ca,
      amount: Number(solToUse),
      decimals: SOL_DECIMALS,
      slippage: Math.ceil((customSlippage? Number(customSlippage) : Number(slippage)) * 100),
      failed: false,
    };
    onAddBuyTask(task);
  }, [onAddBuyTask, ca, slippage, customSlippage, solToUse]);

  const setPresetSlippage = useCallback((slippage: string) => {
    setCustomSlippage(""); 
    setSlippage(slippage);
  }, []);

  const onCopyPublicKey = useCallback(async() => {
    navigator.clipboard.writeText(keypair.publicKey.toBase58());
    setHasCopied(true);
    setTimeout(() => {
      setHasCopied(false);
    }, 1000);
  }, [keypair]);

  useEffect(() => {
    onSlippageChanged(Math.ceil((customSlippage? Number(customSlippage) : Number(slippage)) * 100));
  }, [slippage, customSlippage, onSlippageChanged]);

  return (
    <>
    {/** Header */}
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', position: 'relative' }}>
        <button style={{ fontSize: 12 }} onClick={onTokenButtonClick}>Tokens</button>
        <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', border: 1, borderStyle: 'solid', borderColor: 'gray', borderRadius: 5, height: 25, paddingLeft: 10, paddingRight: 10 }}>
          <a href={`https://radiance.kidas.app/?address=${keypair?.publicKey.toBase58() ?? ""}`} target="_blank" rel="noopener noreferrer">
            <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
              <span style={{fontSize: 8}}>{ellipsizeThis(keypair?.publicKey.toBase58() ?? "", 5, 5) ?? "Not Loaded"}</span>
            </div>
          </a>
          <div style={{ width: 1, height: '100%', backgroundColor: 'gray', marginLeft: 5, marginRight: 5}}></div>

          <button style={{ fontSize: 12 }} onClick={onCopyPublicKey}>{hasCopied? 'Copied' : 'Copy'}</button>
        </div>
        <button style={{ fontSize: 12 }} onClick={onSettingsButtonClick}>Settings</button>
      </div>

      {/** Balances */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%', marginTop: 50, marginBottom: 50 }}>
        <span style={{ fontSize: 30, fontWeight: 'bold' }}>${toLocaleDecimal(totalValue, 2, 2)}</span>
        <span style={{ fontSize: 16, marginTop: 3 }}>({shortenNumber(totalSolValue)} SOL)</span>
        <button style={{ fontSize: 12, marginTop: 12, color: 'grey' }} onClick={getData}>Refresh</button>
      </div>

      {/** Volumes */}
      {/* <div style={{ display: 'flex', flexDirection: 'column', width: '100%', marginBottom: 20}}>
        <div style={{display: 'flex', flexDirection: 'row', justifyContent: 'space-between'}}>
          <span style={{ fontSize: 15 }}>Volume</span>
          <strong style={{ fontSize: 15 }}>100 SOL</strong>
        </div>
        <div style={{display: 'flex', flexDirection: 'row', justifyContent: 'space-between', marginTop: 3}}>
          <span style={{ fontSize: 15 }}>PnL</span>
          <strong style={{ fontSize: 15 }}>120 SOL</strong>
        </div>
      </div> */}

      {/** Slippage */}
      <strong style={{ fontSize: 18, marginBottom: 2, textAlign: 'start' }}>Slippage</strong>
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
        <div style={{ display: 'flex', flexDirection: 'row', width: '100%' }}>
          <button style={{ width: '100%', background: 'white', color: 'black', border: '1px solid black' }} className={slippage === "0.5" && !customSlippage? 'active' : ''} onClick={() => { setPresetSlippage("0.5") }}>0.5%</button>
          <button style={{ width: '100%', background: 'white', color: 'black', border: '1px solid black' }} className={slippage === "1" && !customSlippage? 'active' : ''} onClick={() => { setPresetSlippage("1") }}>1%</button>
          <button style={{ width: '100%', background: 'white', color: 'black', border: '1px solid black' }} className={slippage === "5" && !customSlippage? 'active' : ''} onClick={() => { setPresetSlippage("5") }}>5%</button>
          <button style={{ width: '100%', background: 'white', color: 'black', border: '1px solid black' }} className={slippage === "10" && !customSlippage? 'active' : ''} onClick={() => { setPresetSlippage("10") }}>10%</button>
        </div>
        <input 
          type="number" 
          className={customSlippage? 'active' : ''}
          placeholder='Custom' 
          style={{ textAlign: 'center', width: '99%' }} 
          value={customSlippage} 
          onChange={({target}) => { 
            setCustomSlippage(target.value)
          }}
        />
      </div>

      {/** Tasks */}
      <div style={{display: 'flex', flexDirection: 'row', justifyContent: 'space-between', width: '100%', paddingTop: 15}}>
        <strong style={{ fontSize: 18 }}>Buy <span style={{ fontSize: 12 }}>(Max: {Math.ceil((solBalance - SAFE_RENT_VALUE) * SOL_DECIMALS) / SOL_DECIMALS} SOL)</span></strong>
        <button onClick={getCA} style={{ padding: 0, color: '#649fff' }}>
          Fill CA
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
        <input type="text" value={ca} onChange={({target}) => { setCA(target.value)} } placeholder='Token Address' className='ca' style={{ width: '99%' }}/>
        <div style={{ display: 'flex', flexDirection: 'row', width: '100%', justifyContent: 'space-between', paddingTop: 5}}>
          <input 
            type="number" 
            placeholder='Number of SOLs to use' 
            style={{ textAlign: 'center', width: '98%', margin: 0, }} 
            value={solToUse} 
            onChange={({target}) => { 
              setSolToUse(target.value)
            }}
          />
          <button style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }} onClick={onAddTask}><span style={{ color: '#649fff' }}>Add</span></button>
        </div>
      </div>

      {/** Tasks */}
      <strong style={{ marginTop: 35, fontSize: 18, textAlign: 'start' }}>Pending</strong>
      {
        pendingTasks.length === 0?
        <div style={{ height: 60, width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <span style={{ fontSize: 12 }}>No Pending Tasks</span>
        </div> :
        <ul style={{ fontSize: 15, textAlign: 'left', listStyle: 'none', margin: 0, marginTop: 10, paddingLeft: 0, width: '100%' }}>
        {
          pendingTasks.map((x, index) => {
            let message = <></>;
            switch(x.type) {
              case "buy":
                message = <><div style={{ padding: 2, borderRadius: 2, backgroundColor: 'limegreen', width: 40, textAlign: 'center', marginRight: 5 }}>Buy</div>{ellipsizeThis(x.ca, 5, 5)} - {shortenNumber(x.amount)} SOL {x.slippage / 100}% slippage</>;
                break;
              case "sell":
                message = <><div style={{ padding: 2, borderRadius: 2, backgroundColor: 'orangered', width: 40, textAlign: 'center', marginRight: 5 }}>Sell</div>{shortenNumber(x.amount)}  {ellipsizeThis(x.ca, 5, 5)} - {x.slippage / 100}% slippage</>;
                break;
              case "closeEmpty":
                message = <><div style={{ padding: 2, borderRadius: 2, backgroundColor: 'rgb(100, 159, 255)', width: 40, textAlign: 'center', marginRight: 5 }}>Close</div><span>Empty Accounts</span></>;
                break;
            }
            return (
              <li key={`recent-${index}`} style={{ width: '100%', marginTop: 2 }}>
                <div style={{ width: '100%', display: 'flex', flexDirection: 'row', justifyContent: 'space-between' }}>
                  <div style={{ fontSize: 12, display: 'flex', flexDirection: 'row', alignItems: 'center' }}>{message}</div>
                  {
                    x.failed &&
                    <>
                    <button style={{ fontSize: 12, color: 'orangered', padding: 5 }} onClick={() => { onRetry(x.uuid) }}>Retry</button>
                    <button style={{ fontSize: 12, color: 'orangered', padding: 5 }} onClick={() => { onRemove(x.uuid) }}>Remove</button>
                    </>
                  }
                </div>
              </li>
            )
          })
        }
        </ul>
      }

      {/** Tokens */}
      <strong style={{ marginTop: 15, fontSize: 18, textAlign: 'start' }}>Recent Txs</strong>
      {
        recentTasks.length === 0?
        <div style={{ height: 60, width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <span style={{ fontSize: 12 }}>No Recent Tasks</span>
        </div> :
        <ul style={{ fontSize: 15, textAlign: 'left', listStyle: 'none', margin: 0, marginTop: 10, paddingLeft: 0 }}>
          {
            recentTasks.map((x, index) => {
              let message = <></>;
              switch(x.type) {
                case "buy":
                  message = <><div style={{ padding: 2, borderRadius: 2, backgroundColor: 'limegreen', width: 40, textAlign: 'center', marginRight: 5 }}>Buy</div><span>{ellipsizeThis(x.ca, 5, 5)} for {shortenNumber(x.amount)} SOL</span></>;
                  break;
                case "sell":
                  message = <><div style={{ padding: 2, borderRadius: 2, backgroundColor: 'orangered', width: 40, textAlign: 'center', marginRight: 5 }}>Sell</div><span>{shortenNumber(x.amount)} {ellipsizeThis(x.ca, 5, 5)}</span></>;
                  break;
                case "closeEmpty":
                  message = <><div style={{ padding: 2, borderRadius: 2, backgroundColor: 'rgb(100, 159, 255)', width: 40, textAlign: 'center', marginRight: 5 }}>Close</div><span>Empty Accounts</span></>;
                  break;
              }
              return (
                <li key={`recent-${index}`} style={{marginTop: 2}}>
                  <a href={`https://solana.fm/tx/${x.txHash}`} target='_blank' rel="noreferrer" style={{ fontSize: 12, display: 'flex', flexDirection: 'row', alignItems: 'center' }} >
                    {message} 
                  </a>
                </li>
              )
            })
          }
        </ul>
      }
      </>
  )
}

function App() {
  const [showTokenPage, setShowTokenPage] = useState(false);
  const [showSettingsPage, setShowSettingsPage] = useState(false);
  const [showLoginPage, setShowLoginPage] = useState(true);
  const [keypair, setKeypair] = useState<Keypair>();
  const [solBalance, setSolBalance] = useState(0);
  const [mintData, setMintData] = useState<MintData>({});
  // const [tradeHistory, setTradeHistory] = useState({});
  const [birdeyeResult, setBirdeyeResult] = useState<BirdeyeResult>();
  const [slippageBps, setSlippageBps] = useState(0);
  const lastUpdateTimestamp = useRef(0);
  const [toggler, setToggler] = useState("");
  const [isPasswordError, setIsPasswordError] = useState(false);
  const [hasClickedLogin, setHasClickedLogin] = useState(false);

  const pendingTasks = useRef<Task[]>([]);
  const recentTasks = useRef<RecentTask[]>([]);

  const getKeypair = useCallback(async() => {
    try {
      let keypair = await getAdminAccount();
      setKeypair(keypair);
      setIsPasswordError(false);
    }

    catch {
      setIsPasswordError(true);
    }
    // let keypair = Keypair.fromSecretKey(new Uint8Array(JSON.parse(`[253,69,176,25,71,176,31,192,106,129,41,144,179,221,137,52,135,97,254,177,120,97,22,116,214,182,0,7,57,233,118,121,219,173,55,99,235,141,77,164,14,63,183,138,25,162,84,20,94,102,243,131,18,190,141,237,103,35,95,140,80,76,123,236]`)));
    // console.log(keypair.secretKey.toString());
    // setKeypair(keypair);
  }, []);

  const getData = useCallback(async(force?: boolean) => {
      if(!keypair) {
        return;
      }

      // dont trigger updates so many times
      if(!force && lastUpdateTimestamp.current > moment().add(-1, 'm').unix()) {
        return;
      }

      lastUpdateTimestamp.current = moment().unix();
      
      let mintData = await getUserTokens(keypair.publicKey);
      let solBalance = await getAddressSOLBalance(keypair.publicKey);
      
      setMintData(mintData);
      setSolBalance(solBalance);
      let res = await axios.post<BirdeyeResult>('https://radiance-be.kidas.app/api/prices', { addresses: [...Object.keys(mintData), SOL_ADDRESS] });
      setBirdeyeResult(res.data);

  }, [keypair]);

  const details = useMemo(() => {
    let tokens: ProcessedToken[] = [];
    let totalValue = solBalance * (birdeyeResult?.[SOL_ADDRESS].value ?? 0);
    let totalSolValue = solBalance;
    
    Object.entries(mintData).forEach(([mintAddress, value]) => {
      if(!birdeyeResult || !birdeyeResult[mintAddress]) {
        return {
          tokens,
          totalValue,
          totalSolValue,
          tokenPriceChange: 0,
          currentValue: 0,
          decimals: 0,
        };
      }
      
      let currentValue = value.amount * birdeyeResult[mintAddress].value;
      let currentSolValue = currentValue / birdeyeResult[SOL_ADDRESS].value;
      tokens.push({
        mintAddress,
        currentAmount: value.amount,
        tokenPrice: birdeyeResult[mintAddress].value,
        tokenPriceChange: birdeyeResult[mintAddress].priceChange24h,
        currentValue,
        decimals: value.decimals,
      });

      totalValue += currentValue;
      totalSolValue += currentSolValue;
    });

    tokens = tokens.sort((a,b) => a.currentValue > b.currentValue? -1 : 1);
    return {
      tokens,
      totalValue,
      totalSolValue,
    }
  }, [mintData, birdeyeResult, solBalance]);

  const executeCloseAccount = useCallback(async(task: Task) => {
    if(!keypair) {
      return;
    }
    let connection = new Connection(await getRPCEndpoint());
    let tx = await getCloseEmptyAccountTxs(keypair.publicKey.toBase58());
    tx = addPriorityFeeToTransaction(tx, 50_000, 200_000);
    tx.feePayer = keypair.publicKey;

    let failCount = 0;
    let maxFailCount = await getRetryCount();
    // -1 = no max limit
    while(failCount < maxFailCount || maxFailCount === -1) {
      try {
        console.log('Closing account');
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
        tx.lastValidBlockHeight = lastValidBlockHeight;
        tx.recentBlockhash = blockhash;
        const signature = await connection.sendTransaction(tx, [keypair], { skipPreflight: true });
        let res = await connection.confirmTransaction({
            blockhash: blockhash,
            lastValidBlockHeight: lastValidBlockHeight,
            signature,
        });
  
        // has error
        if(!!res.value.err) {
          continue;
        }

        pendingTasks.current = pendingTasks.current.filter(x => x.uuid !== task.uuid);
        if(recentTasks.current.length === 5) {
          recentTasks.current.pop();
        }

        recentTasks.current.unshift({
          ...task,
          txHash: signature
        });
        setPendingTasks(pendingTasks.current);
        setRecentTasks(recentTasks.current);
        setToggler(v4());
        console.log('Closed');
        break;
      }

      catch(e) {
        console.log(e);
        failCount++;
      }
    }

    pendingTasks.current.forEach((pendingTask, index) => {
      if(pendingTask.uuid !== task.uuid) {
        return;
      }

      pendingTasks.current[index].failed = true;
      setToggler(v4());
    });
    getData(true);
  }, [keypair, getData]);

  const executeSwap = useCallback(async (task: Task) => {
    if(!keypair) {
      return;
    }

    if(task.type !== "buy" && task.type !== "sell") {
      return;
    }

    let failCount = 0;
    let maxFailCount = await getRetryCount();

    // -1 = no max limit
    while(failCount < maxFailCount || maxFailCount === -1) {
      try {
        let amount = Math.round(task.amount * task.decimals);

        let {signature, hasError} = await swap(keypair, task.ca, amount, task.slippage, task.type);
        if(hasError) {
          throw Error("Swap Error");
        }
        pendingTasks.current = pendingTasks.current.filter(x => x.uuid !== task.uuid);
        if(recentTasks.current.length === 5) {
          recentTasks.current.pop();
        }

        recentTasks.current.unshift({
          ...task,
          txHash: signature
        });
        setPendingTasks(pendingTasks.current);
        setRecentTasks(recentTasks.current);
        setToggler(v4());
        break;
      }

      catch(e) {
        console.log(e);
        failCount++;
      }
    }

    pendingTasks.current.forEach((pendingTask, index) => {
      if(pendingTask.uuid !== task.uuid) {
        return;
      }

      pendingTasks.current[index].failed = true;
      setToggler(v4());
    });

    getData(true);
  }, [keypair, getData]);

  const executeTask = useCallback((task: Task) => {
    switch(task.type) {
      case "buy":
      case "sell":
        executeSwap(task);
        break;

      case "closeEmpty":
        executeCloseAccount(task);
        break;

      default:
        break;
    }
  }, [ executeSwap, executeCloseAccount ]);

  const onAddBuyTask = useCallback(async(task: Task) => {
    if(task.amount > solBalance - SAFE_RENT_VALUE) {
      return;
    }

    pendingTasks.current.unshift(task);
    await setPendingTasks(pendingTasks.current);
    executeTask(task);
    setToggler(v4());

  }, [ solBalance, executeTask ]);

  const onAddSellTask = useCallback(async(task: Task) => {
    pendingTasks.current.unshift(task);
    await setPendingTasks(pendingTasks.current);
    executeTask(task);
    setToggler(v4());
    setShowTokenPage(false);
  }, [ executeTask ]);

  const onRetry = useCallback((uuid: string) => {
    pendingTasks.current.forEach((x, index) => {
      if(x.uuid !== uuid) {
        return;
      }
      pendingTasks.current[index].failed = false;
      executeTask(x);
      setToggler(v4());
    });
  }, [ executeTask ]);

  const onRemove = useCallback((uuid: string) => {
    pendingTasks.current = pendingTasks.current.filter(x => x.uuid !== uuid);
    setPendingTasks(pendingTasks.current);
    setToggler(v4());
  }, []);

  const onCloseEmptyAccountClick = useCallback(async() => {
    let task: Task = {
      uuid: v4(),
      type: "closeEmpty",
      amount: 0,
      ca: "",
      decimals: 0,
      slippage: 0,
      failed: false,
    };

    pendingTasks.current.unshift(task);
    await setPendingTasks(pendingTasks.current);
    executeTask(task);
    setToggler(v4());
    setShowTokenPage(false);
  }, [ executeTask ]);

  useEffect(() => {
    getData();
  }, [getData]);

  useEffect(() => {
    getKeypair();
  }, [getKeypair]);

  useEffect(() => {
    const getTasks = async() => {
      let storedPendingTasks = await getPendingTasks();
      let storedRecentTasks = await getRecentTasks();

      // set retry
      storedPendingTasks.forEach((task, index) => {
        storedPendingTasks[index].failed = true;
      });

      pendingTasks.current = storedPendingTasks;
      recentTasks.current = storedRecentTasks;

      setToggler(v4());
    }

    getTasks();
  }, []);

  if(!keypair) {
    return (
      <div className="App">
        <LoginPage
          show={showLoginPage}
          onLogin={() => {
            getKeypair();
            setHasClickedLogin(true);
          }}
          isPasswordError={isPasswordError && hasClickedLogin}
        />
      </div>
    )
  }

  return (
    <div className="App">
      <div style={{ display: 'flex', flexDirection: 'column', height: '98vh', width: '95vw'}}>
        <Main 
          onTokenButtonClick={() => { setShowTokenPage(true) }}
          onSettingsButtonClick={() => { setShowSettingsPage(true) }}
          keypair={keypair}
          totalValue={details.totalValue}
          totalSolValue={details.totalSolValue}
          solBalance={solBalance}
          getData={getData}
          onSlippageChanged={(slippage) => { setSlippageBps(slippage) }}
          onAddBuyTask={onAddBuyTask}
          pendingTasks={pendingTasks.current}
          recentTasks={recentTasks.current}
          onRetry={onRetry}
          onRemove={onRemove}
        />
        <TokenPage 
          show={showTokenPage}
          onBackClick={() => { setShowTokenPage(false) }}
          tokens={details.tokens}
          birdeyeResult={birdeyeResult}
          slippageBps={slippageBps}
          onAddSellTask={onAddSellTask}
          onCloseEmptyAccountClick={onCloseEmptyAccountClick}
        />
        <SettingsPage 
          show={showSettingsPage}
          onBackClick={() => { setShowSettingsPage(false) }}
          onLogout={() => { 
            setShowSettingsPage(false);
            setShowTokenPage(false);
            getKeypair();
           }}
        />
      </div>
    </div>
  );
}

export default App;
