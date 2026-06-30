// SPDX-License-Identifier: GPL-3.0
/*
    Copyright 2021 0KIMS association.

    This file is generated with [snarkJS](https://github.com/iden3/snarkjs).

    snarkJS is a free software: you can redistribute it and/or modify it
    under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    snarkJS is distributed in the hope that it will be useful, but WITHOUT
    ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
    or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public
    License for more details.

    You should have received a copy of the GNU General Public License
    along with snarkJS. If not, see <https://www.gnu.org/licenses/>.
*/

pragma solidity ^0.8.27;

contract AnonEncNullifierKycSanctionsVerifierMVP {
    // Scalar field size
    uint256 constant r    = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    // Base field size
    uint256 constant q   = 21888242871839275222246405745257275088696311157297823662689037894645226208583;

    // Verification Key data
    uint256 constant alphax  = 20491192805390485299153009773594534940189261866228447918068658471970481763042;
    uint256 constant alphay  = 9383485363053290200918347156157836566562967994039712273449902621266178545958;
    uint256 constant betax1  = 4252822878758300859123897981450591353533073413197771768651442665752259397132;
    uint256 constant betax2  = 6375614351688725206403948262868962793625744043794305715222011528459656738731;
    uint256 constant betay1  = 21847035105528745403288232691147584728191162732299865338377159692350059136679;
    uint256 constant betay2  = 10505242626370262277552901082094356697409835680220590971873171140371331206856;
    uint256 constant gammax1 = 11559732032986387107991004021392285783925812861821192530917403151452391805634;
    uint256 constant gammax2 = 10857046999023057135944570762232829481370756359578518086990519993285655852781;
    uint256 constant gammay1 = 4082367875863433681332203403145435568316851327593401208105741076214120093531;
    uint256 constant gammay2 = 8495653923123431417604973247489272438418190587263600148770280649306958101930;
    uint256 constant deltax1 = 18101583706217430829269167082287110596061333748248115798024721806759232581963;
    uint256 constant deltax2 = 5366945061538853835654105679007792039101500773521836686920208002326849455040;
    uint256 constant deltay1 = 9184086298336877344879819230630141178027876202240297669924925880871456658006;
    uint256 constant deltay2 = 10607822642136789963565709237598480597216045942472769844277453805360096892315;

    
    uint256 constant IC0x = 6012740413136087487044022681775885575576830009758048697856207078438480047057;
    uint256 constant IC0y = 15375726287701415825600350210531374654040539477917942271108264229654612022295;
    
    uint256 constant IC1x = 1195001067095537953746244921395362388364304997575628728147157785881257022033;
    uint256 constant IC1y = 20350687583270165059015983061806794915617891519962142274663609976670545337140;
    
    uint256 constant IC2x = 21177462642451637886680815460311161003680429403590162244664278610545314418653;
    uint256 constant IC2y = 13204179795655563940784342736239367807521745645835053586967865616208025293603;
    
    uint256 constant IC3x = 10649604960528523465295552824885969496080377572316295470997376164388161513343;
    uint256 constant IC3y = 2391452844688139425083532540007186499476882667394003171332129435256001626020;
    
    uint256 constant IC4x = 12628472953502654743456493366149119252575621454776012590599054577242631830922;
    uint256 constant IC4y = 8691051069053856637797942373655047129531547681457015395775655681380404672720;
    
    uint256 constant IC5x = 5003133690385989181524838754446638369289144427114918791066399579707702509680;
    uint256 constant IC5y = 19556005583699923614167571886216798745622327159399958175543196618408238082923;
    
    uint256 constant IC6x = 18967076733414691596166405171439429685646131877147855344006260330229340940799;
    uint256 constant IC6y = 10680587644792274689475326045665853177006282310092980304223456348974283080695;
    
    uint256 constant IC7x = 14025518540199999458396651584395353802093487495413475105918835289430029926364;
    uint256 constant IC7y = 12561938179502071618815776715809671506081958798152467736819009835045915312178;
    
    uint256 constant IC8x = 6801363513648973208424556050102003612118622711335346565913519160081712208569;
    uint256 constant IC8y = 6688883888224303107894989875346432013109462532098952982371266211154515670484;
    
    uint256 constant IC9x = 20023729789384937672651413053744447926091093641322088392726881540648139391959;
    uint256 constant IC9y = 10853418682866859068848151978472208663144226414076376157519201779587545649458;
    
    uint256 constant IC10x = 19066987784244454941255932886741118160608778896065604953082708857163060137204;
    uint256 constant IC10y = 18954258709141750425938701890430462247168202494092045459252831896446057690127;
    
    uint256 constant IC11x = 16145768802645720319443917785097992754343998980596422368600994203673218528802;
    uint256 constant IC11y = 7278662900175239846815475668098364205510548674020019496086796218916436539642;
    
    uint256 constant IC12x = 4544825808690809995885325503796205907626803084214863646753442113747229870359;
    uint256 constant IC12y = 1650978768206549874790073619050476937958652162401517225970059409034305123398;
    
    uint256 constant IC13x = 19367138627230295891844154882552531433587113801902497887877309194529927092195;
    uint256 constant IC13y = 16660823678068612991340088739126779414032281022966746145953294453281417897882;
    
    uint256 constant IC14x = 14971524638320169477869325486142261356837433461475655519760070826337527819933;
    uint256 constant IC14y = 14939212558083003197819656785315230062462252943825743022366717465842000404463;
    
    uint256 constant IC15x = 12161449529529837508377299010068845718048887872562214235079711681521814125225;
    uint256 constant IC15y = 19355436907962313562460232846004696722071287452745808129263995776530341245568;
    
    uint256 constant IC16x = 6405731715098213507987968229685146310798593814251935057814803379797405854844;
    uint256 constant IC16y = 6120615498216807008850496202427017960312330998059564143557656143597785263918;
    
    uint256 constant IC17x = 18568713829989090821697352183131162378508422058217835363335202849562098028011;
    uint256 constant IC17y = 21518378437929518746972860760102300066756856975347251261765625559003862465868;
    
    uint256 constant IC18x = 5383295097820036824561887949130747863002784244909898853980460093757645484283;
    uint256 constant IC18y = 13414070695323078905633182599114185297503339565098331382618287723931663324669;
    
    uint256 constant IC19x = 13191335831824389563020758798996060977972411813572107608595251103271614808838;
    uint256 constant IC19y = 2533593712078250049307538900793777740407908540854214234552037806100603753367;
    
    uint256 constant IC20x = 20336911823246683633638090481803736817222474549380239173798830917866780175457;
    uint256 constant IC20y = 15484370482138368538459005643446390582742014281319172724916750354404196625971;
    
 
    // Memory data
    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;

    uint16 constant pLastMem = 896;

    function verifyProof(uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC, uint[20] calldata _pubSignals) public view returns (bool) {
        assembly {
            function checkField(v) {
                if iszero(lt(v, r)) {
                    mstore(0, 0)
                    return(0, 0x20)
                }
            }
            
            // G1 function to multiply a G1 value(x,y) to value in an address
            function g1_mulAccC(pR, x, y, s) {
                let success
                let mIn := mload(0x40)
                mstore(mIn, x)
                mstore(add(mIn, 32), y)
                mstore(add(mIn, 64), s)

                success := staticcall(sub(gas(), 2000), 7, mIn, 96, mIn, 64)

                if iszero(success) {
                    mstore(0, 0)
                    return(0, 0x20)
                }

                mstore(add(mIn, 64), mload(pR))
                mstore(add(mIn, 96), mload(add(pR, 32)))

                success := staticcall(sub(gas(), 2000), 6, mIn, 128, pR, 64)

                if iszero(success) {
                    mstore(0, 0)
                    return(0, 0x20)
                }
            }

            function checkPairing(pA, pB, pC, pubSignals, pMem) -> isOk {
                let _pPairing := add(pMem, pPairing)
                let _pVk := add(pMem, pVk)

                mstore(_pVk, IC0x)
                mstore(add(_pVk, 32), IC0y)

                // Compute the linear combination vk_x
                
                g1_mulAccC(_pVk, IC1x, IC1y, calldataload(add(pubSignals, 0)))
                
                g1_mulAccC(_pVk, IC2x, IC2y, calldataload(add(pubSignals, 32)))
                
                g1_mulAccC(_pVk, IC3x, IC3y, calldataload(add(pubSignals, 64)))
                
                g1_mulAccC(_pVk, IC4x, IC4y, calldataload(add(pubSignals, 96)))
                
                g1_mulAccC(_pVk, IC5x, IC5y, calldataload(add(pubSignals, 128)))
                
                g1_mulAccC(_pVk, IC6x, IC6y, calldataload(add(pubSignals, 160)))
                
                g1_mulAccC(_pVk, IC7x, IC7y, calldataload(add(pubSignals, 192)))
                
                g1_mulAccC(_pVk, IC8x, IC8y, calldataload(add(pubSignals, 224)))
                
                g1_mulAccC(_pVk, IC9x, IC9y, calldataload(add(pubSignals, 256)))
                
                g1_mulAccC(_pVk, IC10x, IC10y, calldataload(add(pubSignals, 288)))
                
                g1_mulAccC(_pVk, IC11x, IC11y, calldataload(add(pubSignals, 320)))
                
                g1_mulAccC(_pVk, IC12x, IC12y, calldataload(add(pubSignals, 352)))
                
                g1_mulAccC(_pVk, IC13x, IC13y, calldataload(add(pubSignals, 384)))
                
                g1_mulAccC(_pVk, IC14x, IC14y, calldataload(add(pubSignals, 416)))
                
                g1_mulAccC(_pVk, IC15x, IC15y, calldataload(add(pubSignals, 448)))
                
                g1_mulAccC(_pVk, IC16x, IC16y, calldataload(add(pubSignals, 480)))
                
                g1_mulAccC(_pVk, IC17x, IC17y, calldataload(add(pubSignals, 512)))
                
                g1_mulAccC(_pVk, IC18x, IC18y, calldataload(add(pubSignals, 544)))
                
                g1_mulAccC(_pVk, IC19x, IC19y, calldataload(add(pubSignals, 576)))
                
                g1_mulAccC(_pVk, IC20x, IC20y, calldataload(add(pubSignals, 608)))
                

                // -A
                mstore(_pPairing, calldataload(pA))
                mstore(add(_pPairing, 32), mod(sub(q, calldataload(add(pA, 32))), q))

                // B
                mstore(add(_pPairing, 64), calldataload(pB))
                mstore(add(_pPairing, 96), calldataload(add(pB, 32)))
                mstore(add(_pPairing, 128), calldataload(add(pB, 64)))
                mstore(add(_pPairing, 160), calldataload(add(pB, 96)))

                // alpha1
                mstore(add(_pPairing, 192), alphax)
                mstore(add(_pPairing, 224), alphay)

                // beta2
                mstore(add(_pPairing, 256), betax1)
                mstore(add(_pPairing, 288), betax2)
                mstore(add(_pPairing, 320), betay1)
                mstore(add(_pPairing, 352), betay2)

                // vk_x
                mstore(add(_pPairing, 384), mload(add(pMem, pVk)))
                mstore(add(_pPairing, 416), mload(add(pMem, add(pVk, 32))))


                // gamma2
                mstore(add(_pPairing, 448), gammax1)
                mstore(add(_pPairing, 480), gammax2)
                mstore(add(_pPairing, 512), gammay1)
                mstore(add(_pPairing, 544), gammay2)

                // C
                mstore(add(_pPairing, 576), calldataload(pC))
                mstore(add(_pPairing, 608), calldataload(add(pC, 32)))

                // delta2
                mstore(add(_pPairing, 640), deltax1)
                mstore(add(_pPairing, 672), deltax2)
                mstore(add(_pPairing, 704), deltay1)
                mstore(add(_pPairing, 736), deltay2)


                let success := staticcall(sub(gas(), 2000), 8, _pPairing, 768, _pPairing, 0x20)

                isOk := and(success, mload(_pPairing))
            }

            let pMem := mload(0x40)
            mstore(0x40, add(pMem, pLastMem))

            // Validate that all evaluations ∈ F
            
            checkField(calldataload(add(_pubSignals, 0)))
            
            checkField(calldataload(add(_pubSignals, 32)))
            
            checkField(calldataload(add(_pubSignals, 64)))
            
            checkField(calldataload(add(_pubSignals, 96)))
            
            checkField(calldataload(add(_pubSignals, 128)))
            
            checkField(calldataload(add(_pubSignals, 160)))
            
            checkField(calldataload(add(_pubSignals, 192)))
            
            checkField(calldataload(add(_pubSignals, 224)))
            
            checkField(calldataload(add(_pubSignals, 256)))
            
            checkField(calldataload(add(_pubSignals, 288)))
            
            checkField(calldataload(add(_pubSignals, 320)))
            
            checkField(calldataload(add(_pubSignals, 352)))
            
            checkField(calldataload(add(_pubSignals, 384)))
            
            checkField(calldataload(add(_pubSignals, 416)))
            
            checkField(calldataload(add(_pubSignals, 448)))
            
            checkField(calldataload(add(_pubSignals, 480)))
            
            checkField(calldataload(add(_pubSignals, 512)))
            
            checkField(calldataload(add(_pubSignals, 544)))
            
            checkField(calldataload(add(_pubSignals, 576)))
            
            checkField(calldataload(add(_pubSignals, 608)))
            

            // Validate all evaluations
            let isValid := checkPairing(_pA, _pB, _pC, _pubSignals, pMem)

            mstore(0, isValid)
             return(0, 0x20)
         }
     }
 }
