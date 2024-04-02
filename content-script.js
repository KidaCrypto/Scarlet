chrome.runtime.onMessage.addListener(
    function(request, sender, sendResponse) {
     
        if(request["type"] == 'msg_from_popup'){
            let aTags = document.querySelectorAll('a[href*="solscan.io/token"]');
            let ca = "";
            // ignore SOL and USDC
            let ignore = ["So11111111111111111111111111111111111111112", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"];
            aTags.forEach(a => {
                let currentTokenAddress = a.href.split("https://solscan.io/token/")[1];
                if(ignore.includes(currentTokenAddress)) {
                    return;
                } 

                ca = currentTokenAddress;
            })
            sendResponse(ca);// this is how you send message to popup
        }
        return true; // this make sure sendResponse will work asynchronously
    }
);