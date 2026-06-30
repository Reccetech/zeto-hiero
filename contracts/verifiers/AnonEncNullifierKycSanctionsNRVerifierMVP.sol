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

contract AnonEncNullifierKycSanctionsNRVerifierMVP {
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
    uint256 constant deltax1 = 11926789018609916636426411281188721526868830978060149072276027828559431728669;
    uint256 constant deltax2 = 16749760073396851727019094989825197096745760717168085834513882219826943286082;
    uint256 constant deltay1 = 17121371913997844159583038928924085923000703350657624886422787400887492959556;
    uint256 constant deltay2 = 16972188466442465592890407560084165631871659908057574101688553594302639762983;

    
    uint256 constant IC0x = 19170139287688532339519092680195320665560161237809843362498330683495499104801;
    uint256 constant IC0y = 6818845747888229007232726552138822653851900389175242234002538349068799629787;
    
    uint256 constant IC1x = 19238117426290332498622628453592653766207497673210049913292121267496669967314;
    uint256 constant IC1y = 4032343157640520498488277265026882507050702614884746668568927554629241766300;
    
    uint256 constant IC2x = 823797140720739145566156833688671752954041541768172609466293661224342075710;
    uint256 constant IC2y = 9953887998692363734994713532878422056348130434179039672495898559118917355107;
    
    uint256 constant IC3x = 11513039469356800169481072693532172675466788872692495019110071343830288571501;
    uint256 constant IC3y = 19357533036796515979240102999071733874580106559816015799873276511729605750244;
    
    uint256 constant IC4x = 1719120403710590578198024274261307259906421869250560240803269817632010751609;
    uint256 constant IC4y = 13270933443758222114917451074336675720298273705968140212290957062503770246681;
    
    uint256 constant IC5x = 4211184634601242542253236004010927636428846228657744940368172950585545241226;
    uint256 constant IC5y = 7781878298973582087575598398325367673156220446061736033076125071158023129672;
    
    uint256 constant IC6x = 2074277293609033451914913679740892356984445842543490722478651780270900318595;
    uint256 constant IC6y = 1618579215689813077298773485169556607113789656259130009944760486360187786370;
    
    uint256 constant IC7x = 21301846065866649023773812262138126158364147654227095522564948879326559543124;
    uint256 constant IC7y = 1031990482507694102478216193229757411514508904390896128444889869856268831043;
    
    uint256 constant IC8x = 8112390155387961846973890863314099917938915532852469161007300302665583286274;
    uint256 constant IC8y = 7040852695278174944172848861810108558084029799123074191946734114535090018126;
    
    uint256 constant IC9x = 4974900073905817639533279517800801123484452838684902537309600446717128109581;
    uint256 constant IC9y = 10874046152238363091905503062956678406209187427262996031040587915035749545785;
    
    uint256 constant IC10x = 4237148964890073913356320127934165643436828501477679739397241394972272190273;
    uint256 constant IC10y = 10445518198075392624369961711410011209349233803289546104027536688282932852065;
    
    uint256 constant IC11x = 11992781826113902257688497153025177928053783112742798284588183203748497308138;
    uint256 constant IC11y = 300622428444729490239567579089527518717891598958883214725123769576373393164;
    
    uint256 constant IC12x = 7998808337335842845571810659235802842373389215334113417065446651379452128133;
    uint256 constant IC12y = 6104011966851632033068137158732727006587913084830875589736534345065792592890;
    
    uint256 constant IC13x = 4821524914351789943451503089069965933407202924497734560832912889349131663484;
    uint256 constant IC13y = 1682716439501860853023922997568119609742780746671564741417169906136662114185;
    
    uint256 constant IC14x = 7633014691954434719703323383329863963192792012413340951963849705122643782959;
    uint256 constant IC14y = 3310018779339736188128467746987480665195069638414329080758346110648089346065;
    
    uint256 constant IC15x = 17315388323427490299328488081860781647541742314527742006821271798898264902024;
    uint256 constant IC15y = 8013583826297672913470273477517876007160911529007051489655330118786691028153;
    
    uint256 constant IC16x = 10898991977597549330486549768226020116899617036154139518849552543757428774561;
    uint256 constant IC16y = 2395064686679554416293139677056202096247825674565760269323565877096533620827;
    
    uint256 constant IC17x = 13712049094434204169400554251480322399410490222575308024157373597561834176781;
    uint256 constant IC17y = 1271382858587173793196280354316667893571237904244645050317626503932068693908;
    
    uint256 constant IC18x = 13109345622776601506337802969326083177294238333421502304842728310164006943201;
    uint256 constant IC18y = 20616703800790746894328600463491900161248047749210520305734539961410395801386;
    
    uint256 constant IC19x = 2670071288795693599498999632613961407605376628507571131148266095629100195018;
    uint256 constant IC19y = 17334748550511227276045225173297436383107101154171829019021883147959521355010;
    
    uint256 constant IC20x = 1415521678539497854644625544616264238161434392386074319180850465920286317515;
    uint256 constant IC20y = 14808233465916014979609345904162187573478185429075680292727953176478212195284;
    
    uint256 constant IC21x = 21016899742293471102658320546737357912952703714837724600253176491800272226762;
    uint256 constant IC21y = 12489599161438128778894678180963524380276250673653354938018849705588439651728;
    
    uint256 constant IC22x = 13664356236778167231273052095058466368445772170358186708291696114654799812802;
    uint256 constant IC22y = 5055054703599039954290839272961076719831574882686505814100548016670761840640;
    
    uint256 constant IC23x = 6542633016271080783198449418754296397723595398199756705093845506984605736692;
    uint256 constant IC23y = 12790877417941011018835594038890281415967364716282611258635591519817054812509;
    
    uint256 constant IC24x = 2441830843657163911977167037566077050413578813043624308534138074905806934036;
    uint256 constant IC24y = 8438550606994618975836777766729146601145732040825710023849789740654912424981;
    
    uint256 constant IC25x = 6935254388621546481969932089106051857967089962403477403088948524404212239356;
    uint256 constant IC25y = 2861760272961380972155893386965676484483809961042143741224810384123739865984;
    
    uint256 constant IC26x = 19347337367290529090796262119358751576051984414877542379801675223624590930268;
    uint256 constant IC26y = 6697810531236149169909087105241849977798247639110121285008006586020715973019;
    
    uint256 constant IC27x = 15861768499248875965454527403067582714794012422708107298951940308115934697009;
    uint256 constant IC27y = 250610674804219839510825938534956380007708751489573472226373276165345386037;
    
    uint256 constant IC28x = 10074980336327692459474708891653410408688552560026792945929092172097135640970;
    uint256 constant IC28y = 16402838146596358475358513704358725289070506247634948261714521067680264866352;
    
    uint256 constant IC29x = 8955996999924702359580934988632285555574067302231951416644055240371319817549;
    uint256 constant IC29y = 4204578996297578789797882079440140844477820426733495044700432325390836904337;
    
    uint256 constant IC30x = 18666270671530034210295905752952641806792632918054716856687492715554768164095;
    uint256 constant IC30y = 7899779771863887135515671550045359661234967468339652357262687350539005098927;
    
    uint256 constant IC31x = 3070744016968478919236646285109829396606406952789838526447573568613200586524;
    uint256 constant IC31y = 3399660185865270383398137694845493080850521248573531732467801859651877178391;
    
    uint256 constant IC32x = 17617045342423011455879125971960082945205896520754662290839221949278614481877;
    uint256 constant IC32y = 12848151023138613258074701867273134695987520085121001135872056394495692778668;
    
    uint256 constant IC33x = 5933394075015246569802798149907639715068139283968589948953781802409594536897;
    uint256 constant IC33y = 19621060872068771972564243807235402347650009007857977926234755170107778572402;
    
    uint256 constant IC34x = 10927380391910741324462689264530158433602265904405183230521826285120021498597;
    uint256 constant IC34y = 6132672409881719133756074270497026835315624624135953294707996964338687469952;
    
    uint256 constant IC35x = 3455235490215296539000891141599908454185822496309982508335345573196964469819;
    uint256 constant IC35y = 16720514698078207296663780888386267232294218167527332703994200373584913254052;
    
    uint256 constant IC36x = 10834506710030920303031579850612899174476730708018988301497592732266817488732;
    uint256 constant IC36y = 13274964464436763681675987269550826050377241170846677037492453350699853922401;
    
    uint256 constant IC37x = 9308690478107409945253571324565640834905984804776959553848688775719374192833;
    uint256 constant IC37y = 11749000943268793601417909620920802599501820433568194667866993120260064091204;
    
    uint256 constant IC38x = 9470339490574624448888444071575521797837084232713900443829064126623352063967;
    uint256 constant IC38y = 7864152438877312619682576932364005764616619572436480599410411697942222718415;
    
 
    // Memory data
    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;

    uint16 constant pLastMem = 896;

    function verifyProof(uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC, uint[38] calldata _pubSignals) public view returns (bool) {
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
                
                g1_mulAccC(_pVk, IC21x, IC21y, calldataload(add(pubSignals, 640)))
                
                g1_mulAccC(_pVk, IC22x, IC22y, calldataload(add(pubSignals, 672)))
                
                g1_mulAccC(_pVk, IC23x, IC23y, calldataload(add(pubSignals, 704)))
                
                g1_mulAccC(_pVk, IC24x, IC24y, calldataload(add(pubSignals, 736)))
                
                g1_mulAccC(_pVk, IC25x, IC25y, calldataload(add(pubSignals, 768)))
                
                g1_mulAccC(_pVk, IC26x, IC26y, calldataload(add(pubSignals, 800)))
                
                g1_mulAccC(_pVk, IC27x, IC27y, calldataload(add(pubSignals, 832)))
                
                g1_mulAccC(_pVk, IC28x, IC28y, calldataload(add(pubSignals, 864)))
                
                g1_mulAccC(_pVk, IC29x, IC29y, calldataload(add(pubSignals, 896)))
                
                g1_mulAccC(_pVk, IC30x, IC30y, calldataload(add(pubSignals, 928)))
                
                g1_mulAccC(_pVk, IC31x, IC31y, calldataload(add(pubSignals, 960)))
                
                g1_mulAccC(_pVk, IC32x, IC32y, calldataload(add(pubSignals, 992)))
                
                g1_mulAccC(_pVk, IC33x, IC33y, calldataload(add(pubSignals, 1024)))
                
                g1_mulAccC(_pVk, IC34x, IC34y, calldataload(add(pubSignals, 1056)))
                
                g1_mulAccC(_pVk, IC35x, IC35y, calldataload(add(pubSignals, 1088)))
                
                g1_mulAccC(_pVk, IC36x, IC36y, calldataload(add(pubSignals, 1120)))
                
                g1_mulAccC(_pVk, IC37x, IC37y, calldataload(add(pubSignals, 1152)))
                
                g1_mulAccC(_pVk, IC38x, IC38y, calldataload(add(pubSignals, 1184)))
                

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
            
            checkField(calldataload(add(_pubSignals, 640)))
            
            checkField(calldataload(add(_pubSignals, 672)))
            
            checkField(calldataload(add(_pubSignals, 704)))
            
            checkField(calldataload(add(_pubSignals, 736)))
            
            checkField(calldataload(add(_pubSignals, 768)))
            
            checkField(calldataload(add(_pubSignals, 800)))
            
            checkField(calldataload(add(_pubSignals, 832)))
            
            checkField(calldataload(add(_pubSignals, 864)))
            
            checkField(calldataload(add(_pubSignals, 896)))
            
            checkField(calldataload(add(_pubSignals, 928)))
            
            checkField(calldataload(add(_pubSignals, 960)))
            
            checkField(calldataload(add(_pubSignals, 992)))
            
            checkField(calldataload(add(_pubSignals, 1024)))
            
            checkField(calldataload(add(_pubSignals, 1056)))
            
            checkField(calldataload(add(_pubSignals, 1088)))
            
            checkField(calldataload(add(_pubSignals, 1120)))
            
            checkField(calldataload(add(_pubSignals, 1152)))
            
            checkField(calldataload(add(_pubSignals, 1184)))
            

            // Validate all evaluations
            let isValid := checkPairing(_pA, _pB, _pC, _pubSignals, pMem)

            mstore(0, isValid)
             return(0, 0x20)
         }
     }
 }
