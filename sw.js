/**
 * Copyright 2018 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// If the loader is already loaded, just stop.
if (!self.define) {
  let registry = {};

  // Used for `eval` and `importScripts` where we can't get script URL by other means.
  // In both cases, it's safe to use a global var because those functions are synchronous.
  let nextDefineUri;

  const singleRequire = (uri, parentUri) => {
    uri = new URL(uri + ".js", parentUri).href;
    return registry[uri] || (
      
        new Promise(resolve => {
          if ("document" in self) {
            const script = document.createElement("script");
            script.src = uri;
            script.onload = resolve;
            document.head.appendChild(script);
          } else {
            nextDefineUri = uri;
            importScripts(uri);
            resolve();
          }
        })
      
      .then(() => {
        let promise = registry[uri];
        if (!promise) {
          throw new Error(`Module ${uri} didn’t register its module`);
        }
        return promise;
      })
    );
  };

  self.define = (depsNames, factory) => {
    const uri = nextDefineUri || ("document" in self ? document.currentScript.src : "") || location.href;
    if (registry[uri]) {
      // Module is already loading or loaded.
      return;
    }
    let exports = {};
    const require = depUri => singleRequire(depUri, uri);
    const specialDeps = {
      module: { uri },
      exports,
      require
    };
    registry[uri] = Promise.all(depsNames.map(
      depName => specialDeps[depName] || require(depName)
    )).then(deps => {
      factory(...deps);
      return exports;
    });
  };
}
define(['./workbox-f0c192c2'], (function (workbox) { 'use strict';

  self.addEventListener('message', event => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
      self.skipWaiting();
    }
  });

  /**
   * The precacheAndRoute() method efficiently caches and responds to
   * requests for URLs in the manifest.
   * See https://goo.gl/S9QRab
   */
  workbox.precacheAndRoute([{
    "url": "manifest.webmanifest",
    "revision": "be83ab2a43e6d9dbb2c02c9e9be65453"
  }, {
    "url": "index.html",
    "revision": "7a9695ab06d2451d4a0a9e05a8fc1a1b"
  }, {
    "url": "favicon.svg",
    "revision": "cd3875d7b46f7c4a646596c7966e9f61"
  }, {
    "url": "icons/icon-maskable-512.png",
    "revision": "8017287dd8fc20bce5eabba6af612cba"
  }, {
    "url": "icons/icon-512.svg",
    "revision": "983b7ef8c47a1be40f9165440adb22a0"
  }, {
    "url": "icons/icon-512.png",
    "revision": "eb24b68b71775dac6b477d53507315e1"
  }, {
    "url": "icons/icon-192.svg",
    "revision": "e673914ac46882957556f3ecc86e5eaa"
  }, {
    "url": "icons/icon-192.png",
    "revision": "5cc7d88042361cf9d522520d95743adc"
  }, {
    "url": "assets/z80-Hz9HOZM7.js",
    "revision": null
  }, {
    "url": "assets/yacas-BJ4BC0dw.js",
    "revision": null
  }, {
    "url": "assets/xquery-DzFWVndE.js",
    "revision": null
  }, {
    "url": "assets/workbox-window.prod.es5-BBnX5xw4.js",
    "revision": null
  }, {
    "url": "assets/webidl-ZXfAyPTL.js",
    "revision": null
  }, {
    "url": "assets/vhdl-lSbBsy5d.js",
    "revision": null
  }, {
    "url": "assets/verilog-C6RDOZhf.js",
    "revision": null
  }, {
    "url": "assets/velocity-D8B20fx6.js",
    "revision": null
  }, {
    "url": "assets/vbscript-BuJXcnF6.js",
    "revision": null
  }, {
    "url": "assets/vb-CmGdzxic.js",
    "revision": null
  }, {
    "url": "assets/turtle-B1tBg_DP.js",
    "revision": null
  }, {
    "url": "assets/ttcn-cfg-B9xdYoR4.js",
    "revision": null
  }, {
    "url": "assets/ttcn-CfJYG6tj.js",
    "revision": null
  }, {
    "url": "assets/troff-wAsdV37c.js",
    "revision": null
  }, {
    "url": "assets/toml-Bm5Em-hy.js",
    "revision": null
  }, {
    "url": "assets/tiki-DGYXhP31.js",
    "revision": null
  }, {
    "url": "assets/tiddlywiki-DO-Gjzrf.js",
    "revision": null
  }, {
    "url": "assets/textile-CnDTJFAw.js",
    "revision": null
  }, {
    "url": "assets/tcl-DVfN8rqt.js",
    "revision": null
  }, {
    "url": "assets/swift-BzpIVaGY.js",
    "revision": null
  }, {
    "url": "assets/stylus-B533Al4x.js",
    "revision": null
  }, {
    "url": "assets/stex-C3f8Ysf7.js",
    "revision": null
  }, {
    "url": "assets/sql-D0XecflT.js",
    "revision": null
  }, {
    "url": "assets/spreadsheet-BCZA_wO0.js",
    "revision": null
  }, {
    "url": "assets/sparql-DkYu6x3z.js",
    "revision": null
  }, {
    "url": "assets/solr-DehyRSwq.js",
    "revision": null
  }, {
    "url": "assets/smalltalk-CnHTOXQT.js",
    "revision": null
  }, {
    "url": "assets/simple-mode-GW_nhZxv.js",
    "revision": null
  }, {
    "url": "assets/sieve-C3Gn_uJK.js",
    "revision": null
  }, {
    "url": "assets/shell-CjFT_Tl9.js",
    "revision": null
  }, {
    "url": "assets/scheme-C41bIUwD.js",
    "revision": null
  }, {
    "url": "assets/sas-B4kiWyti.js",
    "revision": null
  }, {
    "url": "assets/ruby-BK5aLJev.js",
    "revision": null
  }, {
    "url": "assets/rpm-CTu-6PCP.js",
    "revision": null
  }, {
    "url": "assets/r-B6wPVr8A.js",
    "revision": null
  }, {
    "url": "assets/q-pXgVlZs6.js",
    "revision": null
  }, {
    "url": "assets/python-BuPzkPfP.js",
    "revision": null
  }, {
    "url": "assets/puppet-DMA9R1ak.js",
    "revision": null
  }, {
    "url": "assets/pug-DeIclll2.js",
    "revision": null
  }, {
    "url": "assets/protobuf-ChK-085T.js",
    "revision": null
  }, {
    "url": "assets/properties-C78fOPTZ.js",
    "revision": null
  }, {
    "url": "assets/powershell-CFHJl5sT.js",
    "revision": null
  }, {
    "url": "assets/pig-CevX1Tat.js",
    "revision": null
  }, {
    "url": "assets/perl-CdXCOZ3F.js",
    "revision": null
  }, {
    "url": "assets/pascal--L3eBynH.js",
    "revision": null
  }, {
    "url": "assets/oz-BzwKVEFT.js",
    "revision": null
  }, {
    "url": "assets/octave-Ck1zUtKM.js",
    "revision": null
  }, {
    "url": "assets/ntriples-BfvgReVJ.js",
    "revision": null
  }, {
    "url": "assets/nsis-LY0VT_u5.js",
    "revision": null
  }, {
    "url": "assets/nginx-DdIZxoE0.js",
    "revision": null
  }, {
    "url": "assets/mumps-BT43cFF4.js",
    "revision": null
  }, {
    "url": "assets/mscgen-BA5vi2Kp.js",
    "revision": null
  }, {
    "url": "assets/modelica-Dc1JOy9r.js",
    "revision": null
  }, {
    "url": "assets/mllike-CXdrOF99.js",
    "revision": null
  }, {
    "url": "assets/mirc-CjQqDB4T.js",
    "revision": null
  }, {
    "url": "assets/mbox-CNhZ1qSd.js",
    "revision": null
  }, {
    "url": "assets/mathematica-DTrFuWx2.js",
    "revision": null
  }, {
    "url": "assets/lua-VAEuO923.js",
    "revision": null
  }, {
    "url": "assets/livescript-BwQOo05w.js",
    "revision": null
  }, {
    "url": "assets/julia-DuME0IfC.js",
    "revision": null
  }, {
    "url": "assets/javascript-iXu5QeM3.js",
    "revision": null
  }, {
    "url": "assets/index-i4RqdacY.js",
    "revision": null
  }, {
    "url": "assets/index-WVyTeqdn.js",
    "revision": null
  }, {
    "url": "assets/index-WIIRkutk.js",
    "revision": null
  }, {
    "url": "assets/index-Snz80Vb_.css",
    "revision": null
  }, {
    "url": "assets/index-DnE_IKjP.js",
    "revision": null
  }, {
    "url": "assets/index-DhRh0qtu.js",
    "revision": null
  }, {
    "url": "assets/index-Dc_mj82i.js",
    "revision": null
  }, {
    "url": "assets/index-DPYBALW9.js",
    "revision": null
  }, {
    "url": "assets/index-DFN6verR.js",
    "revision": null
  }, {
    "url": "assets/index-Ck-GUCGb.js",
    "revision": null
  }, {
    "url": "assets/index-CjbQZRdM.js",
    "revision": null
  }, {
    "url": "assets/index-CdqLiVCv.js",
    "revision": null
  }, {
    "url": "assets/index-CWcLZltu.js",
    "revision": null
  }, {
    "url": "assets/index-CUnovG25.js",
    "revision": null
  }, {
    "url": "assets/index-CJ4haVVv.js",
    "revision": null
  }, {
    "url": "assets/index-C64AfygR.js",
    "revision": null
  }, {
    "url": "assets/index-C6-gkJre.js",
    "revision": null
  }, {
    "url": "assets/index-C1pcdBbh.js",
    "revision": null
  }, {
    "url": "assets/index-BmwAFaJd.js",
    "revision": null
  }, {
    "url": "assets/index-Bf0P7zpL.js",
    "revision": null
  }, {
    "url": "assets/index-Be6xzxi4.js",
    "revision": null
  }, {
    "url": "assets/index-BU2FczWx.js",
    "revision": null
  }, {
    "url": "assets/index-BNit78tW.js",
    "revision": null
  }, {
    "url": "assets/index-B-AvfLgf.js",
    "revision": null
  }, {
    "url": "assets/idl-BEugSyMb.js",
    "revision": null
  }, {
    "url": "assets/http-DBlCnlav.js",
    "revision": null
  }, {
    "url": "assets/haxe-H-WmDvRZ.js",
    "revision": null
  }, {
    "url": "assets/haskell-Cw1EW3IL.js",
    "revision": null
  }, {
    "url": "assets/groovy-D9Dt4D0W.js",
    "revision": null
  }, {
    "url": "assets/gherkin-heZmZLOM.js",
    "revision": null
  }, {
    "url": "assets/gas-Bneqetm1.js",
    "revision": null
  }, {
    "url": "assets/fortran-DYz_wnZ1.js",
    "revision": null
  }, {
    "url": "assets/forth-Ffai-XNe.js",
    "revision": null
  }, {
    "url": "assets/fcl-Kvtd6kyn.js",
    "revision": null
  }, {
    "url": "assets/factor-kuTfRLto.js",
    "revision": null
  }, {
    "url": "assets/erlang-BNw1qcRV.js",
    "revision": null
  }, {
    "url": "assets/elm-vLlmbW-K.js",
    "revision": null
  }, {
    "url": "assets/eiffel-CnydiIhH.js",
    "revision": null
  }, {
    "url": "assets/ecl-Cabwm37j.js",
    "revision": null
  }, {
    "url": "assets/ebnf-CDyGwa7X.js",
    "revision": null
  }, {
    "url": "assets/dylan-DwRh75JA.js",
    "revision": null
  }, {
    "url": "assets/dtd-DF_7sFjM.js",
    "revision": null
  }, {
    "url": "assets/dockerfile-BKs6k2Af.js",
    "revision": null
  }, {
    "url": "assets/diff-DbItnlRl.js",
    "revision": null
  }, {
    "url": "assets/d-pRatUO7H.js",
    "revision": null
  }, {
    "url": "assets/cypher-C_CwsFkJ.js",
    "revision": null
  }, {
    "url": "assets/css-BnMrqG3P.js",
    "revision": null
  }, {
    "url": "assets/crystal-SjHAIU92.js",
    "revision": null
  }, {
    "url": "assets/commonlisp-DBKNyK5s.js",
    "revision": null
  }, {
    "url": "assets/coffeescript-S37ZYGWr.js",
    "revision": null
  }, {
    "url": "assets/cobol-CWcv1MsR.js",
    "revision": null
  }, {
    "url": "assets/cmake-BQqOBYOt.js",
    "revision": null
  }, {
    "url": "assets/clojure-BMjYHr_A.js",
    "revision": null
  }, {
    "url": "assets/clike-B9uivgTg.js",
    "revision": null
  }, {
    "url": "assets/brainfuck-C4LP7Hcl.js",
    "revision": null
  }, {
    "url": "assets/asterisk-B-8jnY81.js",
    "revision": null
  }, {
    "url": "assets/asn1-EdZsLKOL.js",
    "revision": null
  }, {
    "url": "assets/asciiarmor-Df11BRmG.js",
    "revision": null
  }, {
    "url": "assets/apl-B4CMkyY2.js",
    "revision": null
  }, {
    "url": "favicon.svg",
    "revision": "cd3875d7b46f7c4a646596c7966e9f61"
  }, {
    "url": "manifest.webmanifest",
    "revision": "be83ab2a43e6d9dbb2c02c9e9be65453"
  }], {});
  workbox.cleanupOutdatedCaches();
  workbox.registerRoute(new workbox.NavigationRoute(workbox.createHandlerBoundToURL("/my-edit/index.html")));

}));
