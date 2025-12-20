// EPG Service - Simple and Clean
// Uses times from mi.tv/meuguia.tv exactly as displayed (no timezone conversion)

interface EPGProgram {
    id: string;
    start: string;
    end: string;
    title: string;
    description?: string;
    channel_id: string;
}

// Manual channel mappings for mi.tv
const mitvMappings: Record<string, string> = {
    // HBO channels
    'hbo': 'hbo',
    'hbo 2': 'hbo-2',
    'hbo2': 'hbo-2',
    'hbo family': 'hbo-family-hd',
    'hbo mundi': 'max-1',
    'hbo plus': 'hbo-plus-brasil-hd',
    'hbo pop': 'max-up',
    'hbo xtreme': 'max-prime',
    'hbo signature': 'hbo-signature',
    // Globo
    'globo': 'rede-globo',
    'rede globo': 'rede-globo',
    'globo sp': 'globo-s-o-paulo-hd',
    'globo rj': 'globo-rio-hd',
    'globo rio': 'globo-rio-hd',
    'globo minas': 'globo-belo-horizonte',
    'globo mg': 'globo-belo-horizonte',
    'globo belo horizonte': 'globo-belo-horizonte',
    // SBT
    'sbt sp': 'sbt-s-o-paulo',
    // Record
    'record sp': 'recordtv-s-o-paulo-hd',
    // TV Gazeta
    'tv gazeta': 'tv-gazeta-hd',
    'gazeta': 'tv-gazeta-hd',
    // TNT
    'tnt series': 'tnt-series-hd',
    // Discovery channels
    'discovery': 'discovery',
    'discovery channel': 'discovery',
    'disc turbo': 'discovery-turbo',
    'discovery turbo': 'discovery-turbo',
    'disc home & health': 'discovery-home-health',
    'discovery home & health': 'discovery-home-health',
    'discovery home and health': 'discovery-home-health',
    // Cartoon Network
    'cartoon network': 'cartoon',
    'cartoon': 'cartoon',
    // Play TV
    'play tv': 'play-tv',
    'playtv': 'play-tv',
    // Lifetime
    'lifetime': 'lifetime-brazil',
    // Fish TV
    'fish tv': 'fishtv',
    'fishtv': 'fishtv',
    // Cinebrasil TV
    'cinebrasil tv': 'cinebrasil-tv',
    'cinebrasil': 'cinebrasil-tv',
    // Chef TV
    'chef tv': 'chef-tv',
    // Arte1
    'arte1': 'arte-1',
    'arte 1': 'arte-1',
    // RIT
    'rit': 'rit',
    'rit tv': 'rit',
    // Canção Nova
    'cancao nova': 'canc-o-nova',
    'canção nova': 'canc-o-nova',
    // Boa Vontade TV
    'boa vontade tv': 'boa-vontade-tv',
    'boa vontade': 'boa-vontade-tv',
    // Rede CNT
    'cnt': 'cnt',
    'rede cnt': 'cnt',
    // Woohoo
    'woohoo': 'woohoo',
    'canal woohoo': 'woohoo',
    // Music Box Brasil
    'music box brasil': 'music-box-brasil',
    'musicbox brasil': 'music-box-brasil',
    // Agro Mais
    'agro mais': 'agromais-hd',
    'agromais': 'agromais-hd',
    // Record News
    'record news': 'record-news-hd',
    // Cartoonito (maps to Boomerang on mi.tv)
    'cartoonito': 'boomerang',
    // TV Ra-Tim-Bum
    'tv ra-tim-bum': 'tv-ra-tim-bum-hd',
    'ra-tim-bum': 'tv-ra-tim-bum-hd',
    'ratimbum': 'tv-ra-tim-bum-hd',
    // History 2
    'history 2': 'h2',
    'h2': 'h2',
    // Discovery channels
    'discovery h&h': 'discovery-home-health',
    'discovery theater': 'discovery-theater-hd',
    'discovery theatre': 'discovery-theater-hd',
    'discovery world': 'discovery-world-hd',
    // Band
    'band': 'band',
    'band sp': 'band',
    'band minas': 'band-minas',
    'band mg': 'band-minas',
    'band rs': 'band-rio-grande-do-sul-hd',
    'band rio grande do sul': 'band-rio-grande-do-sul-hd',
    // Canal Futura
    'canal futura': 'futura',
    'futura': 'futura',
    // Cultura
    'cultura': 'cultura',
    'tv cultura': 'cultura',
    // Loading
    'loading': 'loading',
    // RedeTV
    'redetv': 'rede-tv',
    'rede tv': 'rede-tv',
    // TV Justiça
    'tv justica': 'tv-justica-1',
    'tv justiça': 'tv-justica-1',
    // Conmebol TV / Paramount+
    'conmebol tv 1': 'conmebol-tv-1',
    'conmebol paramount+ 1': 'conmebol-tv-1',
    'conmebol paramount 1': 'conmebol-tv-1',
    'conmebol tv 2': 'conmebol-tv-2',
    'conmebol paramount+ 2': 'conmebol-tv-2',
    'conmebol paramount 2': 'conmebol-tv-2',
    'conmebol tv 3': 'conmebol-tv-3',
    'conmebol paramount+ 3': 'conmebol-tv-3',
    'conmebol paramount 3': 'conmebol-tv-3',
    'conmebol tv 4': 'conmebol-tv-4',
    'conmebol paramount+ 4': 'conmebol-tv-4',
    'conmebol paramount 4': 'conmebol-tv-4',
    // Venus TV
    'venus': 'venus-tv-sd',
    'venus tv': 'venus-tv-sd',
    // Sextreme
    'sextreme': 'sextreme-brazil',
    // SexPrive
    'sex prive': 'sexprive-brasileirinhas',
    'sexprive': 'sexprive-brasileirinhas',
    // Travel Box
    'travel box': 'travel-box-brazil',
    'travel box brazil': 'travel-box-brazil',
    // Prime Box Brasil
    'prime box brasil': 'prime-box-brazil',
    'prime box brazil': 'prime-box-brazil',
    // SporTV
    'sportv 3': 'sportv3',
    'sportv3': 'sportv3',
    'sportv 2': 'sportv2',
    'sportv2': 'sportv2',
    // ESPN Brasil
    'espn brasil': 'espn',
    // Canal Sony
    'canal sony': 'sony-hd',
    'sony': 'sony-hd',
    // BandSports
    'band sports': 'bandsports',
    'bandsports': 'bandsports',
    // Canal Off
    'canal off': 'off',
    'off': 'off',
    // Record Belém
    'record belem': 'recordtv-belem',
    'record belém': 'recordtv-belem',
    'recordtv belem': 'recordtv-belem',
};

// Manual channel mappings for meuguia.tv (fallback)
const meuguiaMappings: Record<string, string> = {
    'hbo signature': 'HFE',
    'combate': '135',
    'espn 5': 'ES5',
    'espn5': 'ES5',
};

// Open-EPG Portugal sources (both files contain different channels)
const OPEN_EPG_PORTUGAL_URLS = [
    'https://www.open-epg.com/files/portugal1.xml',
    'https://www.open-epg.com/files/portugal2.xml'
];

// Open-EPG Argentina sources (7 files contain different channels)
const OPEN_EPG_ARGENTINA_URLS = [
    'https://www.open-epg.com/files/argentina1.xml',
    'https://www.open-epg.com/files/argentina2.xml',
    'https://www.open-epg.com/files/argentina3.xml',
    'https://www.open-epg.com/files/argentina4.xml',
    'https://www.open-epg.com/files/argentina5.xml',
    'https://www.open-epg.com/files/argentina6.xml',
    'https://www.open-epg.com/files/argentina7.xml'
];

// Open-EPG Portugal channel mappings (channel name -> Open-EPG ID)
// IDs use format: "Channel Name.pt" or "Channel Name HD.pt"
const openEpgPortugalMappings: Record<string, string> = {
    // RTP channels
    'rtp 1': 'RTP 1 HD.pt',
    'rtp1': 'RTP 1 HD.pt',
    'rtp 1 hd': 'RTP 1 HD.pt',
    'rtp 2': 'RTP 2 HD.pt',
    'rtp2': 'RTP 2 HD.pt',
    'rtp 2 hd': 'RTP 2 HD.pt',
    'rtp 3': 'RTP 3 HD.pt',
    'rtp3': 'RTP 3 HD.pt',
    'rtp 3 hd': 'RTP 3 HD.pt',
    'rtp açores': 'RTP Açores.pt',
    'rtp acores': 'RTP Açores.pt',
    'rtp madeira': 'RTP Madeira.pt',
    'rtp memória': 'RTP Memoria.pt',
    'rtp memoria': 'RTP Memoria.pt',
    'rtp africa': 'RTP África.pt',
    'rtp áfrica': 'RTP África.pt',
    // SIC channels
    'sic': 'SIC HD.pt',
    'sic hd': 'SIC HD.pt',
    'sic notícias': 'SIC Notícias HD.pt',
    'sic noticias': 'SIC Notícias HD.pt',
    'sic mulher': 'SIC Mulher HD.pt',
    'sic caras': 'SIC Caras HD.pt',
    'sic radical': 'SIC Radical HD.pt',
    'sic k': 'SIC K HD.pt',
    'sic novelas': 'SIC Novelas.pt',
    // TVI channels
    'tvi': 'TVI HD.pt',
    'tvi hd': 'TVI HD.pt',
    'tvi reality': 'TVI Reality HD.pt',
    'v+tvi': 'V+TVI.pt',
    // CMTV
    'cmtv': 'CMTV HD.pt',
    'cmtv hd': 'CMTV HD.pt',
    // CNN Portugal
    'cnn portugal': 'CNN Portugal HD.pt',
    'cnn portugal hd': 'CNN Portugal HD.pt',
    // Sport TV channels
    'sport tv 1': 'SPORT TV1 HD.pt',
    'sport tv1': 'SPORT TV1 HD.pt',
    'sporttv 1': 'SPORT TV1 HD.pt',
    'sporttv1': 'SPORT TV1 HD.pt',
    'sport tv 2': 'SPORT TV2 HD.pt',
    'sport tv2': 'SPORT TV2 HD.pt',
    'sporttv 2': 'SPORT TV2 HD.pt',
    'sporttv2': 'SPORT TV2 HD.pt',
    'sport tv 3': 'SPORT TV3 HD.pt',
    'sport tv3': 'SPORT TV3 HD.pt',
    'sporttv 3': 'SPORT TV3 HD.pt',
    'sporttv3': 'SPORT TV3 HD.pt',
    'sport tv 4': 'SPORT TV4 HD.pt',
    'sport tv4': 'SPORT TV4 HD.pt',
    'sporttv 4': 'SPORT TV4 HD.pt',
    'sporttv4': 'SPORT TV4 HD.pt',
    'sport tv 5': 'SPORT TV5 HD.pt',
    'sport tv5': 'SPORT TV5 HD.pt',
    'sporttv 5': 'SPORT TV5 HD.pt',
    'sporttv5': 'SPORT TV5 HD.pt',
    'sport tv 6': 'Sport TV 6 HD.pt',
    'sport tv6': 'Sport TV 6 HD.pt',
    'sport tv 7': 'Sport TV 7 HD.pt',
    'sport tv7': 'Sport TV 7 HD.pt',
    'sport tv+': 'SPORT TV+ HD.pt',
    'sport tv nba': 'Sport TV NBA.pt',
    // Benfica TV / Porto / Sporting
    'benfica tv': 'BTV1 HD.pt',
    'btv': 'BTV1 HD.pt',
    'btv1': 'BTV1 HD.pt',
    'porto canal': 'Porto Canal HD.pt',
    'sporting tv': 'Sporting TV HD.pt',
    // Eurosport
    'eurosport 1': 'Eurosport 1 HD.pt',
    'eurosport1': 'Eurosport 1 HD.pt',
    'eurosport 2': 'Eurosport 2 HD.pt',
    'eurosport2': 'Eurosport 2 HD.pt',
    // TVCine channels
    'tvcine top': 'TVCine TOP HD.pt',
    'tvcine action': 'TVCine ACTION HD.pt',
    'tvcine emotion': 'TVCine EMOTION HD.pt',
    'tvcine edition': 'TVCine EDITION HD.pt',
    // Hollywood / AXN
    'canal hollywood': 'Canal Hollywood HD.pt',
    'hollywood': 'Canal Hollywood HD.pt',
    'axn': 'AXN HD.pt',
    'axn hd': 'AXN HD.pt',
    'axn movies': 'AXN Movies HD.pt',
    'axn white': 'AXN White HD.pt',
    // Star channels
    'star channel': 'Star Channel HD.pt',
    'star movies': 'Star Movies HD.pt',
    'star life': 'Star Life HD.pt',
    'star crime': 'Star Crime HD.pt',
    'star comedy': 'Star Comedy HD.pt',
    // AMC channels
    'amc': 'AMC HD.pt',
    'amc hd': 'AMC HD.pt',
    'amc crime': 'AMC Crime HD.pt',
    'amc break': 'AMC Break HD.pt',
    // Syfy
    'syfy': 'Syfy HD.pt',
    'syfy hd': 'Syfy HD.pt',
    // Discovery / National Geographic
    'discovery': 'Discovery HD.pt',
    'discovery hd': 'Discovery HD.pt',
    'national geographic': 'National Geographic HD.pt',
    'nat geo': 'National Geographic HD.pt',
    'national geographic wild': 'National Geographic WILD HD.pt',
    'nat geo wild': 'National Geographic WILD HD.pt',
    // History
    'canal história': 'Canal Historia HD.pt',
    'canal historia': 'Canal Historia HD.pt',
    'history': 'Canal Historia HD.pt',
    // Food / Kitchen
    '24 kitchen': '24Kitchen HD.pt',
    '24kitchen': '24Kitchen.pt',
    'food network': 'Food Network HD.pt',
    // Kids channels
    'cartoon network': 'Cartoon Network.pt',
    'cartoon': 'Cartoon Network.pt',
    'cartoonito': 'Cartoonito.pt',
    'disney channel': 'Disney Channel HD.pt',
    'disney junior': 'Disney Junior HD.pt',
    'nickelodeon': 'Nickelodeon.pt',
    'nick jr': 'Nick Jr..pt',
    'biggs': 'Biggs.pt',
    'canal panda': 'Canal Panda HD.pt',
    'panda': 'Canal Panda HD.pt',
    'baby tv': 'Baby TV.pt',
    // Music channels
    'mtv portugal': 'MTV Portugal HD.pt',
    'mtv': 'MTV Portugal HD.pt',
    'mtv live': 'MTV Live.pt',
    'afro music': 'Afro Music.pt',
    'afromusic': 'Afro Music.pt',
    // DAZN channels
    'dazn 1': 'DAZN 1.pt',
    'dazn 2': 'DAZN 2.pt',
    'dazn 3': 'DAZN 3.pt',
    'dazn 4': 'DAZN 4.pt',
    'dazn 5': 'DAZN 5.pt',
    'dazn 6': 'DAZN 6.pt',
    // Globo
    'globo': 'Globo HD.pt',
    'globo hd': 'Globo HD.pt',
    'globo news': 'Globo News.pt',
    // Other Portuguese channels
    'odisseia': 'ODISSEIA HD.pt',
    'canal nos': 'Canal NOS HD.pt',
    'nos studios': 'NOS Studios HD.pt',
    'tlc': 'TLC.pt',
    'e!': 'E! Entertainment HD.pt',
    'e! entertainment': 'E! Entertainment HD.pt',
    'id investigation': 'ID Investigation Discovery.pt',
    'investigation discovery': 'ID Investigation Discovery.pt',
    'travel channel': 'Travel Channel HD.pt',
    'max': 'MAX.pt',
    // News channels
    'cnn': 'CNN.pt',
    'euronews': 'Euronews.pt',
    'bloomberg': 'Bloomberg.pt',
    'sky news': 'Sky News.pt',
    // A Bola TV
    'a bola tv': 'A Bola.pt',
    'a bola': 'A Bola.pt',
    'abola': 'A Bola.pt',
    // Al Jazeera
    'al jazeera': 'Aljazeera.pt',
    'aljazeera': 'Aljazeera.pt',
    // Alma Lusa
    'alma lusa': 'Alma Lusa.pt',
    // BBC
    'bbc entertainment': 'BBC Entertainment.pt',
    'bbc world news': 'BBC World News.pt',
    'bbc world': 'BBC World News.pt',
    // Blaze
    'blaze': 'Blaze.pt',
    // Caça e Pesca
    'caca e pesca': 'Caça e Pesca.pt',
    'caça e pesca': 'Caça e Pesca.pt',
    // Caçavision
    'cacavision': 'Caçavision.pt',
    'caçavision': 'Caçavision.pt',
    // Canal 11
    'canal 11': '11.pt',
    // Canal 180
    'canal 180': 'CANAL 180.pt',
    // Canal Q
    'canal q': 'Canal Q.pt',
    // Cancao Nova
    'cancao nova': 'Cançao Nova.pt',
    'canção nova': 'Cançao Nova.pt',
    // Casa e Cozinha
    'casa e cozinha': 'Casa e Cozinha.pt',
    // CBS Reality
    'cbs reality': 'CBS Reality.pt',
    // Cinemundo  
    'cinemundo': 'Cinemundo.pt',
    // Clubbing TV
    'clubbing tv': 'Clubbing TV.pt',
    // CNBC
    'cnbc': 'CNBC.pt',
    'cnbc europe': 'CNBC.pt',
    // Crime + Investigation
    'crime + investigation': 'Crime + Investigation.pt',
    'crime investigation': 'Crime + Investigation.pt',
    'crime+investigation': 'Crime + Investigation.pt',
    // Dog TV
    'dog tv': 'Dog TV.pt',
    'dogtv': 'Dog TV.pt',
    // Fashion TV
    'fashion tv': 'Fashion TV.pt',
    'ftv': 'Fashion TV.pt',
    // Fatima TV
    'fatima tv': 'Fatima TV.pt',
    // Fox channels (Star rebrand)
    'fox': 'FOX HD.pt',
    'fox comedy': 'Star Comedy HD.pt',
    'fox crime': 'Star Crime HD.pt',
    'fox life': 'Star Life HD.pt',
    'fox movies': 'Star Movies HD.pt',
    // Fuel TV
    'fuel tv': 'Fuel TV.pt',
    // Globo Now
    'globo now': 'Globo Now.pt',
    // Jim Jam
    'jim jam': 'Jim Jam.pt',
    'jimjam': 'Jim Jam.pt',
    // Kuriakos TV
    'kuriakos tv': 'Kuriakos.pt',
    'kuriakos': 'Kuriakos.pt',
    // Lolly Kids
    'lolly kids': 'Lolly Kids.pt',
    // MCM channels
    'mcm pop': 'MCM Pop.pt',
    'mcm top': 'MCM Top.pt',
    // Mezzo
    'mezzo': 'Mezzo.pt',
    // Motorvision
    'motorvision': 'Motorvision.pt',
    'motorvision tv': 'Motorvision.pt',
    // Localvisao
    'localvisao': 'Localvisao.pt',
    // Panda Kids
    'panda kids': 'Panda Kids.pt',
    // PFC
    'pfc': 'PFC.pt',
    // Record channels
    'record news': 'Record News.pt',
    'record tv': 'Record TV.pt',
    'record': 'Record TV.pt',
    // Red Bull TV
    'red bull tv': 'Red Bull TV.pt',
    'redbull tv': 'Red Bull TV.pt',
    // S+
    's+': 'S+.pt',
    // TCV International
    'tcv internacional': 'TCV International.pt',
    'tcv internactional': 'TCV International.pt',
    'tcv': 'TCV International.pt',
    // The Qyou
    'the qyou': 'The QYOU.pt',
    'qyou': 'The QYOU.pt',
    // Toros TV
    'toros tv': 'Toros TV.pt',
    // TPA
    'tpa': 'TPA Internacional.pt',
    'tpa internacional': 'TPA Internacional.pt',
    // Trace channels
    'trace toca': 'Trace Toca.pt',
    'trace urban': 'Trace Urban.pt',
    // TV Galicia
    'tv galicia': 'TV Galicia.pt',
    // TV5 Monde
    'tv5 monde': 'TV5 Monde.pt',
    'tv5monde': 'TV5 Monde.pt',
    // TVE channels
    'tve 24h': 'TVE 24H.pt',
    'tve24h': 'TVE 24H.pt',
    'tve internacional': 'TVE Internacional.pt',
    'tve': 'TVE Internacional.pt',
    // TVI channels
    'tvi 24': 'TVI 24 HD.pt',
    'tvi24': 'TVI 24 HD.pt',
    'tvi ficcao': 'TVI Ficção HD.pt',
    'tvi ficção': 'TVI Ficção HD.pt',
    'tvi reality cam 1': 'TVI Reality Cam1.pt',
    'tvi reality cam 2': 'TVI Reality Cam2.pt',
    'tvi reality cam 3': 'TVI Reality Cam3.pt',
    'tvi reality cam 4': 'TVI Reality Cam4.pt',
    'tvi reality mosaico': 'TVI Reality Mosaico.pt',
    // VH1
    'vh1': 'VH1.pt',
    // Zap Viva
    'zap viva': 'Zap Viva.pt',
};

// Open-EPG Argentina channel mappings (channel name -> Open-EPG ID)
// IDs use format: "Channel Name.ar"
const openEpgArgentinaMappings: Record<string, string> = {
    // News channels
    'a24': 'A24.ar',
    'c5n': 'C5N.ar',
    'canal 26': 'Canal 26.ar',
    'cronica': 'CRONICA TV.ar',
    'cronica tv': 'CRONICA TV.ar',
    'tn': 'TN.ar',
    'tn noticias': 'TN.ar',
    // Main channels
    'america': 'AMERICA TV.ar',
    'america tv': 'AMERICA TV.ar',
    'el nueve': 'EL NUEVE.ar',
    'canal 9': 'EL NUEVE.ar',
    'canal 9 hd': 'EL NUEVE.ar',
    'el trece': 'EL TRECE.ar',
    'canal 13': 'EL TRECE.ar',
    'telefe': 'TELEFE.ar',
    'telefe b': 'TELEFE.ar',
    'tv publica': 'TV PUBLICA.ar',
    'tv publica tdf': 'TV PUBLICA.ar',
    // Regional
    'canal 10 rio negro': 'CANAL 10 RIO NEGRO.ar',
    // Movies
    'cine argentino': 'CINE ARGENTINO.ar',
    'cinemundo': 'CINEMUNDO.ar',
    'ciudad magazine': 'CIUDAD MAGAZINE.ar',
    'ciudad magaczine': 'CIUDAD MAGAZINE.ar',
    // Sports
    'directv sports': 'DIRECTV SPORTS.ar',
    'espn': 'ESPN.ar',
    'espn 2': 'ESPN 2.ar',
    'espn 3': 'ESPN 3.ar',
    'fox sports': 'FOX SPORTS.ar',
    'fox sports 2': 'FOX SPORTS 2.ar',
    'fox sports 3': 'FOX SPORTS 3.ar',
    'fox sports premium': 'FOX SPORTS PREMIUM.ar',
    'fox sports premiun': 'FOX SPORTS PREMIUM.ar',
    'tnt sports': 'TNT SPORTS.ar',
    'tyc sports': 'TYC SPORTS.ar',
    // Entertainment
    'axn': 'AXN.ar',
    'axn hd': 'AXN.ar',
    'garage': 'EL GARAGE.ar',
    'el garage': 'EL GARAGE.ar',
    'mas chic': 'MAS CHIC.ar',
    'volver': 'VOLVER.ar',
    // Star channels
    'star action': 'STAR ACTION.ar',
    'star channel': 'STAR CHANNEL.ar',
    'star channel fox': 'STAR CHANNEL.ar',
    'star channel fox hd': 'STAR CHANNEL.ar',
    'star comedy': 'STAR COMEDY.ar',
    'star comedy fox': 'STAR COMEDY.ar',
    'star comedy fox hd': 'STAR COMEDY.ar',
    'star fun': 'STAR FUN.ar',
    'star fun b': 'STAR FUN.ar',
    'star series': 'STAR SERIES.ar',
    // HBO channels
    'hbo': 'HBO.ar',
    'hbo hd': 'HBO.ar',
    'hbo 2': 'HBO 2.ar',
    'hbo 2 hd': 'HBO 2.ar',
    'hbo mundi': 'HBO MUNDI.ar',
    'hbo mundi ingles': 'HBO MUNDI.ar',
    'hbo plus': 'HBO PLUS.ar',
    'hbo plus hd': 'HBO PLUS.ar',
    'hbo pop': 'HBO POP.ar',
    'hbo signature': 'HBO SIGNATURE.ar',
    // Universal channels
    'studio universal': 'STUDIO UNIVERSAL.ar',
    'studio universal hd': 'STUDIO UNIVERSAL.ar',
    'universal channel': 'UNIVERSAL CHANNEL.ar',
    'universal channel hd': 'UNIVERSAL CHANNEL.ar',
    // Kids
    'paka paka': 'PAKA PAKA.ar',
    'pakapaka': 'PAKA PAKA.ar',
};

// Open-EPG USA sources (10 files)
const OPEN_EPG_USA_URLS = [
    'https://www.open-epg.com/files/unitedstates1.xml',
    'https://www.open-epg.com/files/unitedstates2.xml',
    'https://www.open-epg.com/files/unitedstates3.xml',
    'https://www.open-epg.com/files/unitedstates4.xml',
    'https://www.open-epg.com/files/unitedstates6.xml',
    'https://www.open-epg.com/files/unitedstates7.xml',
    'https://www.open-epg.com/files/unitedstates8.xml',
    'https://www.open-epg.com/files/unitedstates9.xml',
    'https://www.open-epg.com/files/unitedstates10.xml',
    'https://www.open-epg.com/files/unitedstates11.xml'
];

// Open-EPG USA channel mappings (channel name -> Open-EPG ID)
const openEpgUSAMappings: Record<string, string> = {
    // A&E
    'a&e': 'AandE Network (East).us',
    'a & e': 'AandE Network (East).us',
    'aande': 'AandE Network (East).us',
    // ABC
    'abc': 'ABC (East).us',
    // ACC Network
    'acc network': 'ACC Network.us',
    // ActionMax
    'action max': 'ActionMAX (East).us',
    'actionmax': 'ActionMAX (East).us',
    '5 starmax': '5StarMAX (East).us',
    '5starmax': '5StarMAX (East).us',
    // Adult Swim
    'adult swim': 'Adult Swim.us',
    // Altitude Sports
    'altitude sports': 'Altitude Sports.us',
    // AMC
    'amc': 'AMC (East).us',
    'amc presents': 'AMC (East).us',
    'amc+': 'AMC+.us',
    // American Heroes Channel
    'american heroes channel': 'American Heroes Channel.us',
    // Animal Planet
    'animal planet': 'Animal Planet (East).us',
    'animal planet (east)': 'Animal Planet (East).us',
    // Antenna TV
    'antenna tv': 'Antenna TV.us',
    // Aspire
    'aspire': 'Aspire.us',
    // AWE
    'awe': 'AWE.us',
    // AXS TV
    'axs tv': 'AXS TV.us',
    // BabyFirst
    'baby first': 'BabyFirst TV.us',
    'babyfirst': 'BabyFirst TV.us',
    // Barstool Sports
    'barstool sports': 'Barstool Sports.us',
    // BBC America
    'bbc america': 'BBC America (East).us',
    // BBC World News
    'bbc world news': 'BBC News North America.us',
    // beIN Sports
    'bein sports xtra': 'beIN Sports (English).us',
    'bein sports': 'beIN Sports (English).us',
    // BET
    'bet': 'Black Entertainment Television (East).us',
    'bet (east)': 'Black Entertainment Television (East).us',
    'bet (west)': 'Black Entertainment Television (West).us',
    'bet gospel': 'BET Gospel.us',
    'bet her': 'BET Her.us',
    'bet jams': 'BET Jams.us',
    'bet soul': 'BET Soul.us',
    // Big Ten Network
    'big ten network': 'Big Ten Network (National).us',
    // Bloomberg
    'bloomberg': 'Bloomberg TV.us',
    // Boomerang
    'boomerang': 'Boomerang.us',
    // Bounce
    'bounce': 'Bounce.us',
    // Bravo
    'bravo': 'Bravo (East).us',
    'bravo (east)': 'Bravo (East).us',
    'bravo (west)': 'Bravo (East).us',
    // Buzzr
    'buzzr': 'Buzzr.us',
    // C-SPAN
    'c-span': 'Cable Satellite Public Affairs Network.us',
    'cspan': 'Cable Satellite Public Affairs Network.us',
    'c-span 2': 'Cable Satellite Public Affairs Network 2.us',
    'cspan 2': 'Cable Satellite Public Affairs Network 2.us',
    'c-span 3': 'Cable Satellite Public Affairs Network 3.us',
    'cspan 3': 'Cable Satellite Public Affairs Network 3.us',
    // Cartoon Network
    'cartoon network': 'Cartoon Network (East).us',
    'cartoon network (east)': 'Cartoon Network (East).us',
    'cartoon network (west)': 'Cartoon Network (West).us',
    // Catchy Comedy
    'catchy comedy': 'Catchy Comedy.us',
    // Catholic TV
    'catholic tv': 'Catholic TV.us',
    // CBS
    'cbs news': 'CBS News.us',
    'cbs news national': 'CBS News.us',
    'cbs sports network': 'CBS Sports Network.us',
    // Charge!
    'charge!': 'Charge.us',
    'charge': 'Charge.us',
    // Cheddar News
    'cheddar news': 'Cheddar News.us',
    // Cinemax
    'cinemax': 'Cinemax (East).us',
    'cinemax (east)': 'Cinemax (East).us',
    'cinemax (west)': 'Cinemax (West).us',
    // Circle TV
    'circle tv': 'Circle.us',
    // Cleo TV
    'cleo tv': 'Cleo TV.us',
    // CMT
    'cmt': 'CMT (East).us',
    // CNBC
    'cnbc': 'Consumer News and Business Channel.us',
    'cnbc world': 'Consumer News and Business Channel World HDTV.us',
    // CNN
    'cnn': 'Cable News Network.us',
    'cnn espanol': 'CNN en Espanol.us',
    // Comedy Central
    'comedy central': 'Comedy Central (East).us',
    // Comet TV
    'comet tv': 'Comet.us',
    'comet': 'Comet.us',
    // Cooking Channel
    'cooking channel': 'Cooking Channel.us',
    // Court TV
    'court tv': 'Court TV.us',
    // Cozi TV
    'cozi tv': 'Cozi TV.us',
    // Crime & Investigation
    'crime & investigation': 'Crime and Investigation (East).us',
    'crime investigation': 'Crime and Investigation (East).us',
    // CW
    'cw': 'CW (East).us',
    // Dabl
    'dabl': 'Dabl.us',
    // Daystar Network
    'daystar network': 'Daystar.us',
    'daystar': 'Daystar.us',
    // Destination America
    'destination america': 'Destination America.us',
    // Discovery Channel
    'discovery channel': 'Discovery Channel (East).us',
    'discovery channel (east)': 'Discovery Channel (East).us',
    'discovery channel (west)': 'Discovery Channel (West).us',
    // Discovery Family
    'discovery family': 'Discovery Family.us',
    // Discovery ID
    'discovery id': 'Investigation Discovery (East).us',
    'discovery id (east)': 'Investigation Discovery (East).us',
    // Discovery Life
    'discovery life': 'Discovery Life Channel.us',
    // Disney Channel
    'disney channel': 'Disney Channel (East).us',
    'disney channel (east)': 'Disney Channel (East).us',
    'disney channel (west)': 'Disney Channel (West).us',
    // Disney Jr
    'disney jr': 'Disney Junior (East).us',
    'disney jr (east)': 'Disney Junior (East).us',
    'disney jr (west)': 'Disney Junior (West).us',
    'disney junior': 'Disney Junior (East).us',
    // Disney XD
    'disney xd': 'Disney XD (East).us',
    'disney xd (east)': 'Disney XD (East).us',
    'disney xd (west)': 'Disney XD (West).us',
    // E! Entertainment
    'e! entertainment': 'E! (East).us',
    'e! entertainment (east)': 'E! (East).us',
    'e! entertainment (west)': 'E! (West).us',
    'e!': 'E! (East).us',
    // EPIX (now MGM+)
    'epix': 'Epix (East).us',
    'epix 2': 'Epix 2 (East).us',
    'epix hits': 'Epix Hits.us',
    // ESPN
    'espn': 'ESPN.us',
    'espn 2': 'ESPN 2.us',
    'espn2': 'ESPN 2.us',
    'espn 3': 'ESPN 3.us',
    'espn3': 'ESPN 3.us',
    'espn 4': 'ESPN.us',
    'espn fhd': 'ESPN.us',
    'espn news': 'ESPN News.us',
    'espnews': 'ESPN News.us',
    'espn u': 'ESPN U.us',
    'espnu': 'ESPN U.us',
    // EWTN
    'ewtn': 'EWTN.us',
    // FETV
    'fetv': 'FETV.us',
    // Fight Network
    'fight network': 'Fight Network.us',
    // Food Network
    'food network': 'Food Network (East).us',
    // Fox Business
    'fox business': 'Fox Business Network.us',
    // Fox News
    'fox news': 'Fox News Channel.us',
    // Fox Soul
    'fox soul': 'Fox Soul.us',
    // Fox Sports
    'fox sports': 'Fox Sports 1.us',
    'fox sports 1': 'Fox Sports 1.us',
    'fox sports 2': 'Fox Sports 2.us',
    'fox sports 4k': 'Fox Sports 1.us',
    'fox sports racing': 'Fox Sports Racing.us',
    // Fox Weather
    'fox weather': 'Fox Weather.us',
    // Freeform
    'freeform': 'Freeform (East).us',
    'freeform (east)': 'Freeform (East).us',
    'freeform (west)': 'Freeform (West).us',
    // Fuse
    'fuse': 'Fuse.us',
    // FX
    'fx': 'FX (East).us',
    // FXM
    'fxm': 'FXM.us',
    // FXX
    'fxx': 'FXX (East).us',
    'fxx (east)': 'FXX (East).us',
    'fxx (west)': 'FXX (West).us',
    // FYI
    'fyi': 'FYI.us',
    // Game Show Network
    'game show network': 'GSN.us',
    'game show network (gsn)': 'GSN.us',
    'gsn': 'GSN.us',
    // GEB TV
    'geb tv': 'GEB America.us',
    // Get TV
    'get tv': 'GetTV.us',
    'gettv': 'GetTV.us',
    // GINX Esports
    'ginx esports': 'GINX Esports TV.us',
    // Golf Channel
    'golf channel': 'Golf Channel.us',
    // Gone Fishing
    'gone fishing': 'Gone Fishing.us',
    // Great American Country
    'great american country': 'GAC Family.us',
    // Grit
    'grit': 'Grit.us',
    // H2
    'h2': 'H2.us',
    // Hallmark channels
    'hallmark': 'Hallmark Channel (East).us',
    'hallmark (east)': 'Hallmark Channel (East).us',
    'hallmark drama': 'Hallmark Drama.us',
    'hallmark movies and mysteries': 'Hallmark Movies and Mysteries.us',
    // HBO
    'hbo': 'HBO (East).us',
    'hbo (east)': 'HBO (East).us',
    'hbo 2': 'HBO 2 (East).us',
    'hbo comedy': 'HBO Comedy (East).us',
    'hbo family': 'HBO Family (East).us',
    'hbo signature': 'HBO Signature (East).us',
    'hbo zone': 'HBO Zone (East).us',
    // Heroes & Icons
    'heroes & icons': 'Heroes and Icons.us',
    'heroes and icons': 'Heroes and Icons.us',
    // HGTV
    'hgtv': 'Home and Garden Television (East).us',
    // Hi-Yah!
    'hi-yah!': 'Hi-YAH.us',
    'hi-yah': 'Hi-YAH.us',
    // HLN
    'hln': 'HLN.us',
    // Hope Channel
    'hope channel': 'Hope Channel.us',
    // IFC
    'ifc': 'IFC (East).us',
    // IGN
    'ign': 'IGN.us',
    // INSP
    'insp': 'Inspirational Network East.us',
    // ION
    'ion': 'ION.us',
    'ion mystery': 'Mystery.us',
    // Law and Crime
    'law and crime': 'Law and Crime.us',
    // Lifetime
    'lifetime': 'Lifetime Television (East).us',
    'lifetime movies': 'Lifetime Movies (East).us',
    'lifetime movies hd': 'Lifetime Movies (East).us',
    // Longhorn Network
    'longhorn network': 'Longhorn Network.us',
    // Marquee Sports Network
    'marquee sports network': 'Marquee Sports Network.us',
    // MASN
    'masn': 'MASN.us',
    'masn 2': 'MASN 2.us',
    // MAV TV
    'mav tv': 'MAVTV.us',
    'mavtv': 'MAVTV.us',
    // MeTV
    'metv': 'MeTV.us',
    'metv+': 'MeTV.us',
    // MLB Network
    'mlb network': 'MLB Network.us',
    'mlbstrike zone': 'MLB Network.us',
    // MLS TV
    'mls tv': 'MLS Season Pass.us',
    // Moremax
    'moremax': 'More Max (East).us',
    // Motor Trend
    'motor trend': 'MotorTrend.us',
    // Movies!
    'movies!': 'Movies.us',
    'movies': 'Movies.us',
    // MSG
    'msg': 'Madison Square Garden (Zone 1).us',
    'msg 2': 'Madison Square Garden (Zone 1).us',
    'msg 2 +': 'Madison Square Garden (Zone 1).us',
    'msg sn': 'Madison Square Garden Sportsnet (Zone 1).us',
    // MSNBC
    'msnbc': 'msnbc.us',
    // MTV
    'mtv': 'MTV (East).us',
    'mtv (east)': 'MTV (East).us',
    'mtv (west)': 'MTV (West).us',
    'mtv u': 'MTV-U.us',
    'mtvu': 'MTV-U.us',
    'mtv2': 'MTV2 (East).us',
    // NASA
    'nasa': 'NASA Television.us',
    'nasa 2': 'NASA Television.us',
    // Nat Geo
    'nat geo wild': 'NatGeo WILD.us',
    'national geographic': 'National Geographic Channel.us',
    'national geographic (east)': 'National Geographic Channel.us',
    'national geographic (west)': 'National Geographic Channel.us',
    // NBA TV
    'nba tv': 'NBA TV.us',
    // NESN
    'nesn': 'New England Sports Network.us',
    'nesn plus': 'New England Sports Network.us',
    // Newsmax
    'newsmax': 'Newsmax.us',
    // NewsNation
    'newsnation': 'NewsNation SDTV.us',
    'newsnation (wgn america)': 'NewsNation SDTV.us',
    // NFL Network
    'nfl network': 'NFL Network.us',
    // Nick Jr
    'nick jr': 'Nick Jr..us',
    'nick jr (east)': 'Nick Jr..us',
    // Nick Music
    'nick music': 'Nick Music.us',
    // Nickelodeon
    'nickelodeon': 'Nickelodeon (East).us',
    'nickelodeon (east)': 'Nickelodeon (East).us',
    'nickelodeon (west)': 'Nickelodeon Too (West).us',
    // Nicktoons
    'nicktoons': 'Nicktoons Network (East).us',
    // One America News
    'one america news': 'One America News Network.us',
    // Outdoor Channel
    'outdoor channel': 'Outdoor Channel.us',
    // Outermax
    'outermax': 'OuterMAX.us',
    // Outside TV
    'outside tv': 'Outside TV.us',
    // OWN
    'own': 'OWN.us',
    // Oxygen
    'oxygen': 'Oxygen (East).us',
    'oxygen (east)': 'Oxygen (East).us',
    'oxygen (west)': 'Oxygen (West).us',
    // Paramount Channel
    'paramount channel': 'Paramount Network (East).us',
    // PBS
    'pbs america': 'PBS America.us',
    'pbs kids': 'PBS Kids.us',
    // People TV
    'people tv': 'People TV.us',
    // Pixl
    'pixl': 'Pixl.us',
    // Pop
    'pop': 'Pop.us',
    // Pursuit
    'pursuit': 'Pursuit Channel.us',
    // Reelz
    'reelz': 'ReelzChannel.us',
    // Retroplex
    'retroplex': 'Retroplex.us',
    // Revolt
    'revolt': 'Revolt.us',
    // RFD TV
    'rfd tv': 'RFD TV.us',
    // Root Sports
    'root sports northwest': 'ROOT Sports Northwest.us',
    // RT America
    'rt america': 'RT America.us',
    // Science
    'science': 'Science.us',
    // SEC Network
    'sec network': 'SEC Network.us',
    // Showtime
    'showtime': 'Showtime (East).us',
    'showtime (east)': 'Showtime (East).us',
    'showtime (west)': 'Showtime (West).us',
    'showtime beyond': 'Showtime (East).us',
    'showtime extreme': 'Showtime Extreme (East).us',
    'showtime family zone': 'Showtime (East).us',
    'showtime next': 'Showtime (East).us',
    'showtime showcase': 'Showtime Showcase (East).us',
    'showtime women': 'Showtime (East).us',
    // Smithsonian
    'smithsonian': 'Smithsonian Channel (East).us',
    'smithsonian (east)': 'Smithsonian Channel (East).us',
    'smithsonian (west)': 'Smithsonian Channel (East).us',
    // Spectrum
    'spectrum news 1': 'Spectrum News 1.us',
    'spectrum sportsnet la dodgers': 'Spectrum SportsNet LA.us',
    'spectrum sportsnet la lakers': 'Spectrum SportsNet LA.us',
    // Sportsnet NY
    'sportsnet ny': 'SportsNet New York.us',
    'sportsnet ny (sny)': 'SportsNet New York.us',
    'sny': 'SportsNet New York.us',
    // Stadium
    'stadium vip': 'Stadium.us',
    'stadium': 'Stadium.us',
    // Start TV
    'start tv': 'Start TV.us',
    // Starz
    'starz': 'Starz (East).us',
    'starz (east)': 'Starz (East).us',
    'starz (west)': 'Starz (West).us',
    'starz cinema': 'Starz Cinema.us',
    'starz comedy': 'Starz Comedy.us',
    'starz edge': 'Starz Edge.us',
    'starz encore': 'Starz Encore (East).us',
    'starz encore (east)': 'Starz Encore (East).us',
    'starz encore (west)': 'Starz Encore (West).us',
    'starz encore action': 'Starz Encore Action.us',
    'starz encore classic': 'Starz Encore Classic.us',
    'starz encore suspense': 'Starz Encore Suspense.us',
    'starz encore westerns': 'Starz Encore Westerns.us',
    'starz in black': 'Starz in Black.us',
    'starz kids & family': 'Starz Kids and Family.us',
    'starz kids and family': 'Starz Kids and Family.us',
    'starzencore family': 'Starz Encore Family.us',
    // Sundance
    'sundance': 'SundanceTV (East).us',
    // Syfy
    'syfy': 'Syfy (East).us',
    'syfy (east)': 'Syfy (East).us',
    'syfy (west)': 'Syfy (East).us',
    // Tastemade
    'tastemade': 'Tastemade.us',
    'tastemade (east)': 'Tastemade.us',
    // TBN
    'tbn': 'Trinity Broadcasting Network.us',
    'tbn enlace tv': 'Enlace.us',
    // TBS
    'tbs': 'TBS Superstation (East).us',
    // TCM
    'tcm': 'TCM.us',
    // Teen Nick
    'teen nick': 'TeenNick (East).us',
    'teennick': 'TeenNick (East).us',
    // Tennis Channel
    'tennis channel': 'Tennis Channel.us',
    // The Blaze
    'the blaze': 'The Blaze.us',
    'blaze': 'The Blaze.us',
    // The Cowboy Channel
    'the cowboy channel': 'The Cowboy Channel.us',
    // The Walk TV
    'the walk tv': 'The Walk TV.us',
    // TheGrio TV
    'thegrio tv': 'TheGrio.us',
    // ThrillerMax
    'thriller max': 'ThrillerMAX.us',
    'thrillermax': 'ThrillerMAX.us',
    // TLC
    'tlc': 'TLC (East).us',
    'tlc (east)': 'TLC (East).us',
    'tlc (west)': 'TLC (West).us',
    // TNT
    'tnt': 'TNT (East).us',
    'tnt (east)': 'TNT (East).us',
    'tnt (west)': 'TNT (East).us',
    // Trace Sport Stars
    'trace sport stars': 'Trace Sport Stars.us',
    // Travel Channel
    'travel channel': 'Travel Channel (East).us',
    'travel channel (east)': 'Travel Channel (East).us',
    'travel channel (west)': 'Travel Channel (West).us',
    // truTV
    'trutv': 'truTV (East).us',
    'trutv (east)': 'truTV (East).us',
    'trutv (west)': 'truTV (West).us',
    // TSN
    'tsn 1': 'TSN 1.us',
    'tsn 2': 'TSN 2.us',
    'tsn 3': 'TSN 3.us',
    'tsn 4': 'TSN 4.us',
    // TV Land
    'tv land': 'TV Land (East).us',
    'tv land (east)': 'TV Land (East).us',
    // TV One
    'tv one': 'TV One.us',
    // TVG
    'tvg': 'TVG Network.us',
    'tvg network': 'TVG Network.us',
    'funduel tv': 'TVG Network.us',
    'funduel tv (tvg)': 'TVG Network.us',
    // TYC Sports
    'tyc sports': 'TyC Sports.us',
    // UFC Fight Pass
    'ufc fight pass': 'UFC Fight Pass.us',
    'ufc fight pass 24/7': 'UFC Fight Pass.us',
    // Unimas
    'unimas': 'UniMas (East).us',
    // Universal Kids
    'universal kids': 'Universal Kids.us',
    // Univision
    'univision': 'Univision (East).us',
    // UP TV
    'up tv': 'UP TV.us',
    // USA Network
    'usa network': 'USA Network (East).us',
    'usa network (east)': 'USA Network (East).us',
    'usa network (west)': 'USA Network (West).us',
    // VH1
    'vh1': 'VH1 (East).us',
    'vh1 (east)': 'VH1 (East).us',
    'vh1 (west)': 'VH1 (West).us',
    // Viceland
    'viceland': 'Viceland.us',
    // VSIN
    'vsin': 'VSiN.us',
    // WE TV
    'we tv': 'WE tv.us',
    'wetv': 'WE tv.us',
    // Weather Channel
    'weather channel': 'The Weather Channel.us',
    // World Fishing Network
    'world fishing network': 'World Fishing Network.us',
    // WWE Network
    'wwe network': 'WWE Network.us',
    'wwe network fhd': 'WWE Network.us',
    // YES Network
    'yes network': 'YES Network.us',
    // AMG
    'amg': 'AMG TV.us',
};

export const epgService = {

    // Main function to fetch EPG for a channel
    async fetchChannelEPG(epgChannelId: string, channelName?: string): Promise<EPGProgram[]> {
        if (!channelName) return [];

        // Check if this is a Portuguese channel (has mapping in Open-EPG Portugal)
        const openEpgPtId = this.getOpenEpgPortugalId(channelName);
        if (openEpgPtId) {
            // Portuguese channels ONLY use Open-EPG Portugal (no mi.tv/meuguia fallback)
            const openEpgPrograms = await this.fetchFromOpenEpgPortugal(channelName, openEpgPtId);
            return openEpgPrograms; // Return even if empty - don't try other sources
        }

        // Check if this is an Argentine channel (has mapping in Open-EPG Argentina)
        const openEpgArId = this.getOpenEpgArgentinaId(channelName);
        if (openEpgArId) {
            // Argentine channels ONLY use Open-EPG Argentina (no mi.tv fallback)
            const openEpgPrograms = await this.fetchFromOpenEpgArgentina(channelName, openEpgArId);
            return openEpgPrograms; // Return even if empty - don't try other sources
        }

        // Check if this is a USA channel (has mapping in Open-EPG USA)
        const openEpgUsaId = this.getOpenEpgUSAId(channelName);
        if (openEpgUsaId) {
            // USA channels ONLY use Open-EPG USA (no mi.tv fallback)
            const openEpgPrograms = await this.fetchFromOpenEpgUSA(channelName, openEpgUsaId);
            return openEpgPrograms; // Return even if empty - don't try other sources
        }

        // For non-matched channels: Try mi.tv (for Brazilian channels)
        const mitvPrograms = await this.fetchFromMiTV(channelName);
        if (mitvPrograms.length > 0) return mitvPrograms;

        // Try meuguia.tv as final fallback
        const meuguiaPrograms = await this.fetchFromMeuGuia(channelName);
        if (meuguiaPrograms.length > 0) return meuguiaPrograms;

        return [];
    },

    // Get Open-EPG Portugal ID from channel name
    getOpenEpgPortugalId(channelName: string): string | null {
        let normalized = channelName.toLowerCase().trim();

        // Remove country prefixes: PT:, PT |, PT-, BR:, etc.
        normalized = normalized.replace(/^(pt|br|portugal|brasil)\s*[:|]\s*/i, '');

        // Remove codec info
        normalized = normalized.replace(/\s*\(?(h\.?265|h\.?264|hevc|avc)\)?/gi, '');

        // Remove quality in parentheses
        normalized = normalized.replace(/\s*\((fhd|hd|sd|4k|uhd|ppv)\)/gi, '');

        // Remove quality/tags in brackets
        normalized = normalized.replace(/\s*\[?(fhd|hd|sd|4k|uhd|m|p)\]?\s*$/i, '');

        normalized = normalized.trim();

        const result = openEpgPortugalMappings[normalized] || null;

        // If not found, try some variations
        if (!result) {
            const variations = [
                normalized.replace(/\s+/g, ''),  // no spaces: "24kitchen"
                normalized.replace(/-/g, ' '),  // hyphens to spaces
            ];
            for (const variant of variations) {
                const varResult = openEpgPortugalMappings[variant];
                if (varResult) {
                    return varResult;
                }
            }
        }

        return result;
    },

    // Fetch from Open-EPG Portugal using the cache system (downloads both portugal1 and portugal2)
    async fetchFromOpenEpgPortugal(channelName: string, channelId: string): Promise<EPGProgram[]> {
        try {
            let combinedXml = '';
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const ipcRenderer = (window as any).ipcRenderer;

            // Download both EPG files and combine them
            if (ipcRenderer?.invoke) {
                for (let i = 0; i < OPEN_EPG_PORTUGAL_URLS.length; i++) {
                    const url = OPEN_EPG_PORTUGAL_URLS[i];
                    const cacheKey = `portugal${i + 1}`;

                    try {
                        const result = await ipcRenderer.invoke('epg:get-cached', {
                            url: url,
                            cacheKey: cacheKey,
                            forceRefresh: false
                        });

                        if (result.success && result.data) {
                            combinedXml += result.data;
                        } else {
                            console.error(`[EPG] Failed to download ${cacheKey}:`, result.error);
                        }
                    } catch (err) {
                        console.error(`[EPG] Error downloading ${cacheKey}:`, err);
                    }
                }
            }

            if (!combinedXml) {
                console.error('[EPG] No XML data received from any source');
                return [];
            }

            return this.parseXMLTV(combinedXml, channelId, channelName);
        } catch (error) {
            console.error('[EPG] Open-EPG Portugal error:', error);
            return [];
        }
    },

    // Get Open-EPG Argentina ID from channel name
    getOpenEpgArgentinaId(channelName: string): string | null {
        let normalized = channelName.toLowerCase().trim();

        // Remove country prefixes: ARG |, ARG:, AR:, etc.
        normalized = normalized.replace(/^(arg|ar|argentina)\s*[:|]\s*/i, '');

        // Remove codec info
        normalized = normalized.replace(/\s*\(?(h\.?265|h\.?264|hevc|avc)\)?/gi, '');

        // Remove quality in parentheses
        normalized = normalized.replace(/\s*\((fhd|hd|sd|4k|uhd|ppv)\)/gi, '');

        // Remove quality/tags in brackets
        normalized = normalized.replace(/\s*\[?(fhd|hd|sd|4k|uhd|m|p)\]?\s*$/i, '');

        normalized = normalized.trim();

        const result = openEpgArgentinaMappings[normalized] || null;

        // Try variations if not found
        if (!result) {
            const variations = [
                normalized.replace(/\s+/g, ''),  // no spaces
                normalized.replace(/-/g, ' '),  // hyphens to spaces
            ];
            for (const variant of variations) {
                const varResult = openEpgArgentinaMappings[variant];
                if (varResult) return varResult;
            }
        }

        return result;
    },

    // Fetch from Open-EPG Argentina using the cache system (downloads all 7 files)
    async fetchFromOpenEpgArgentina(channelName: string, channelId: string): Promise<EPGProgram[]> {
        try {
            let combinedXml = '';
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const ipcRenderer = (window as any).ipcRenderer;

            // Download all 7 EPG files and combine them
            if (ipcRenderer?.invoke) {
                for (let i = 0; i < OPEN_EPG_ARGENTINA_URLS.length; i++) {
                    const url = OPEN_EPG_ARGENTINA_URLS[i];
                    const cacheKey = `argentina${i + 1}`;

                    try {
                        const result = await ipcRenderer.invoke('epg:get-cached', {
                            url: url,
                            cacheKey: cacheKey,
                            forceRefresh: false
                        });

                        if (result.success && result.data) {
                            combinedXml += result.data;
                        } else {
                            console.error(`[EPG] Failed to download ${cacheKey}:`, result.error);
                        }
                    } catch (err) {
                        console.error(`[EPG] Error downloading ${cacheKey}:`, err);
                    }
                }
            }

            if (!combinedXml) {
                console.error('[EPG] No Argentina XML data received');
                return [];
            }

            return this.parseXMLTV(combinedXml, channelId, channelName);
        } catch (error) {
            console.error('[EPG] Open-EPG Argentina error:', error);
            return [];
        }
    },

    // Get Open-EPG USA ID from channel name
    getOpenEpgUSAId(channelName: string): string | null {
        let normalized = channelName.toLowerCase().trim();

        // Remove country prefixes: USA:, USA |, US:, etc.
        normalized = normalized.replace(/^(usa|us)\s*[:|]\s*/i, '');

        // Remove codec info
        normalized = normalized.replace(/\s*\(?(h\.?265|h\.?264|hevc|avc)\)?/gi, '');

        // Remove quality in parentheses
        normalized = normalized.replace(/\s*\((fhd|hd|sd|4k|uhd|ppv)\)/gi, '');

        // Remove quality/tags in brackets
        normalized = normalized.replace(/\s*\[?(fhd|hd|sd|4k|uhd|m|p)\]?\s*$/i, '');

        normalized = normalized.trim();

        const result = openEpgUSAMappings[normalized] || null;

        // Try variations if not found
        if (!result) {
            const variations = [
                normalized.replace(/\s+/g, ''),  // no spaces
                normalized.replace(/-/g, ' '),  // hyphens to spaces
            ];
            for (const variant of variations) {
                const varResult = openEpgUSAMappings[variant];
                if (varResult) return varResult;
            }
        }

        return result;
    },

    // Fetch from Open-EPG USA using the cache system (downloads all 10 files)
    async fetchFromOpenEpgUSA(channelName: string, channelId: string): Promise<EPGProgram[]> {
        try {
            let combinedXml = '';
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const ipcRenderer = (window as any).ipcRenderer;

            // Download all 10 EPG files and combine them
            if (ipcRenderer?.invoke) {
                for (let i = 0; i < OPEN_EPG_USA_URLS.length; i++) {
                    const url = OPEN_EPG_USA_URLS[i];
                    const cacheKey = `usa${i + 1}`;

                    try {
                        const result = await ipcRenderer.invoke('epg:get-cached', {
                            url: url,
                            cacheKey: cacheKey,
                            forceRefresh: false
                        });

                        if (result.success && result.data) {
                            combinedXml += result.data;
                        } else {
                            console.error(`[EPG] Failed to download ${cacheKey}:`, result.error);
                        }
                    } catch (err) {
                        console.error(`[EPG] Error downloading ${cacheKey}:`, err);
                    }
                }
            }

            if (!combinedXml) {
                console.error('[EPG] No USA XML data received');
                return [];
            }

            return this.parseXMLTV(combinedXml, channelId, channelName);
        } catch (error) {
            console.error('[EPG] Open-EPG USA error:', error);
            return [];
        }
    },

    parseXMLTV(xml: string, channelId: string, channelName: string): EPGProgram[] {
        const programs: EPGProgram[] = [];

        // Find all programmes for this channel
        // Use a simpler regex that's more flexible with attribute order and whitespace
        const allProgrammes = xml.match(/<programme[^>]+>[\s\S]*?<\/programme>/gi) || [];

        for (const prog of allProgrammes) {
            // Check if this programme is for our channel
            const channelMatch = prog.match(/channel="([^"]+)"/i);
            if (!channelMatch || channelMatch[1] !== channelId) continue;

            // Extract start and stop times
            const startMatch = prog.match(/start="(\d{14})\s*([+-]\d{4})"/i);
            const stopMatch = prog.match(/stop="(\d{14})\s*([+-]\d{4})"/i);

            if (!startMatch || !stopMatch) continue;

            // Extract title
            const titleMatch = prog.match(/<title[^>]*>([^<]+)<\/title>/i);
            const title = titleMatch ? this.decodeXMLEntities(titleMatch[1]) : 'Sem título';

            // Extract description
            const descMatch = prog.match(/<desc[^>]*>([\s\S]*?)<\/desc>/i);
            const description = descMatch ? this.decodeXMLEntities(descMatch[1]) : '';

            // Parse times
            const startDate = this.parseXMLTVTime(startMatch[1], startMatch[2]);
            const endDate = this.parseXMLTVTime(stopMatch[1], stopMatch[2]);

            if (startDate && endDate) {
                programs.push({
                    id: `openepg-${startDate.getTime()}`,
                    start: startDate.toISOString(),
                    end: endDate.toISOString(),
                    title: title,
                    description: description,
                    channel_id: channelName
                });
            }
        }

        return programs;
    },

    // Parse XMLTV time format: YYYYMMDDHHMMSS +ZZZZ
    parseXMLTVTime(timeStr: string, tzOffset: string): Date | null {
        try {
            const year = parseInt(timeStr.substring(0, 4));
            const month = parseInt(timeStr.substring(4, 6)) - 1; // JS months are 0-indexed
            const day = parseInt(timeStr.substring(6, 8));
            const hour = parseInt(timeStr.substring(8, 10));
            const minute = parseInt(timeStr.substring(10, 12));
            const second = parseInt(timeStr.substring(12, 14));

            // Parse timezone offset (+0000 format)
            const tzSign = tzOffset.startsWith('-') ? -1 : 1;
            const tzHours = parseInt(tzOffset.substring(1, 3));
            const tzMinutes = parseInt(tzOffset.substring(3, 5));
            const tzOffsetMs = tzSign * (tzHours * 60 + tzMinutes) * 60 * 1000;

            // Create date in UTC
            const utcDate = Date.UTC(year, month, day, hour, minute, second);
            // Adjust for timezone offset to get actual UTC time
            const actualUtcMs = utcDate - tzOffsetMs;

            return new Date(actualUtcMs);
        } catch (error) {
            console.error('[EPG] Failed to parse XMLTV time:', timeStr, tzOffset, error);
            return null;
        }
    },

    // Decode XML entities
    decodeXMLEntities(text: string): string {
        return text
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
            .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)));
    },

    // Fetch from mi.tv
    async fetchFromMiTV(channelName: string): Promise<EPGProgram[]> {
        try {
            const slug = this.getMiTVSlug(channelName);

            // Use -300 timezone offset for Brazil (UTC-3 = -180 minutes, but site uses -300)
            const url = `https://mi.tv/br/async/channel/${slug}/-300`;
            const response = await fetch(url);

            if (!response.ok) return [];

            const html = await response.text();
            return this.parseHTML(html, channelName);
        } catch (error) {
            console.error('[EPG] mi.tv error:', error);
            return [];
        }
    },

    // Fetch from meuguia.tv
    async fetchFromMeuGuia(channelName: string): Promise<EPGProgram[]> {
        try {
            const slug = this.getMeuGuiaSlug(channelName);
            if (!slug) return [];

            const url = `https://meuguia.tv/programacao/canal/${slug}`;
            const response = await fetch(url);

            if (!response.ok) return [];

            const html = await response.text();
            return this.parseMeuGuiaHTML(html, channelName);
        } catch (error) {
            console.error('[EPG] meuguia.tv error:', error);
            return [];
        }
    },

    // Get mi.tv slug from channel name
    getMiTVSlug(channelName: string): string {
        // Remove quality/codec/tag suffixes from channel name
        const normalized = channelName
            .toLowerCase()
            .trim()
            // Remove quality in brackets first: [FHD], [HD], [SD], [4K], [UHD], [M], [P]
            .replace(/\s*\[(fhd|hd|sd|4k|uhd|m|p)\]/gi, '')
            // Remove codec info in parentheses: (H265), (H264), (H266), (HEVC), (AVC)
            .replace(/\s*\((h\.?265|h\.?264|h\.?266|hevc|avc)\)/gi, '')
            // Remove quality in parentheses: (FHD), (HD), (SD), (PPV), (4K), (UHD)
            .replace(/\s*\((fhd|hd|sd|4k|uhd|ppv)\)/gi, '')
            // Remove remaining quality/tags at end without brackets: FHD, HD, SD at end
            .replace(/\s+(fhd|hd|sd|4k|uhd)\s*$/gi, '')
            .trim();

        // Check manual mappings first
        if (mitvMappings[normalized]) {
            return mitvMappings[normalized];
        }

        // Auto-generate slug
        return normalized
            .replace(/[àáâãäå]/g, 'a')
            .replace(/[èéêë]/g, 'e')
            .replace(/[ìíîï]/g, 'i')
            .replace(/[òóôõö]/g, 'o')
            .replace(/[ùúûü]/g, 'u')
            .replace(/[ç]/g, 'c')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
    },

    // Get meuguia.tv slug from channel name
    getMeuGuiaSlug(channelName: string): string | null {
        // Remove quality/codec/tag suffixes
        const normalized = channelName
            .toLowerCase()
            .trim()
            // Remove quality in brackets first: [FHD], [HD], [SD], [4K], [UHD], [M], [P]
            .replace(/\s*\[(fhd|hd|sd|4k|uhd|m|p)\]/gi, '')
            // Remove codec info in parentheses: (H265), (H264), (H266), (HEVC), (AVC)
            .replace(/\s*\((h\.?265|h\.?264|h\.?266|hevc|avc)\)/gi, '')
            // Remove quality in parentheses: (FHD), (HD), (SD), (PPV), (4K), (UHD)
            .replace(/\s*\((fhd|hd|sd|4k|uhd|ppv)\)/gi, '')
            // Remove remaining quality/tags at end without brackets
            .replace(/\s+(fhd|hd|sd|4k|uhd)\s*$/gi, '')
            .trim();
        return meuguiaMappings[normalized] || null;
    },

    // Parse mi.tv HTML - SIMPLE: use times exactly as shown
    parseHTML(html: string, channelId: string): EPGProgram[] {
        const programs: EPGProgram[] = [];

        // Simple pattern to match time and title only
        const pattern = /<span[^>]*class="[^"]*time[^"]*"[^>]*>[\s\S]*?(\d{1,2}:\d{2})[\s\S]*?<\/span>[\s\S]*?<h2[^>]*>([\s\S]*?)<\/h2>/gi;

        const today = new Date();
        let lastHour = -1;
        let dayOffset = 0;

        let match;
        while ((match = pattern.exec(html)) !== null) {
            const time = match[1];
            let title = match[2]
                .replace(/<[^>]+>/g, '')
                .replace(/&amp;/g, '&')
                .replace(/&nbsp;/g, ' ')
                .replace(/&#\d+;/g, '')
                .replace(/\s+/g, ' ')
                .trim();

            // Search for episode info in the chunk after this match
            const matchEnd = match.index + match[0].length;
            const nextChunk = html.substring(matchEnd, matchEnd + 500);
            const episodeMatch = nextChunk.match(/Temporada\s+\d+\s+Epis[oó]dio\s+\d+[^<\n]*/i);

            if (episodeMatch) {
                title = `${title} - ${episodeMatch[0].trim()}`;
            }

            if (title.length < 2 || title.length > 200) continue;

            const [hours, minutes] = time.split(':').map(Number);
            if (hours > 23 || minutes > 59) continue;

            // Handle day rollover (when hours go from 23 to 0)
            if (lastHour !== -1 && hours < lastHour - 2) dayOffset++;
            lastHour = hours;

            // Create date using LOCAL time (whatever the site shows)
            const startDate = new Date(
                today.getFullYear(),
                today.getMonth(),
                today.getDate() + dayOffset,
                hours,
                minutes,
                0,
                0
            );

            const endDate = new Date(startDate);
            endDate.setHours(endDate.getHours() + 1);

            programs.push({
                id: `epg-${startDate.getTime()}`,
                start: startDate.toISOString(),
                end: endDate.toISOString(),
                title: title,
                description: '',
                channel_id: channelId
            });
        }

        // Fix end times (use next program's start time)
        for (let i = 0; i < programs.length - 1; i++) {
            programs[i].end = programs[i + 1].start;
        }

        return programs;
    },

    // Parse meuguia.tv HTML
    parseMeuGuiaHTML(html: string, channelId: string): EPGProgram[] {
        const programs: EPGProgram[] = [];

        const pattern = /class=['"][^'"]*time[^'"]*['"][^>]*>(\d{1,2}:\d{2})<\/div>[\s\S]*?<h2[^>]*>([^<]+)<\/h2>/gi;

        // meuguia.tv shows Brazil time (UTC-3)
        // We need to convert to user's local time
        // Brazil offset: -3 hours from UTC (-180 minutes)
        const brazilOffsetMinutes = -180;
        const localOffsetMinutes = new Date().getTimezoneOffset(); // e.g. 300 for EST (UTC-5)
        // Difference: how many minutes ahead is Brazil from user's local time
        // If user is EST (300), Brazil is (-180), difference = 300 - (-180) = 480 minutes = 8 hours? No...
        // Actually: Brazil is UTC-3, EST is UTC-5, so Brazil is 2 hours AHEAD of EST
        // To convert Brazil time to EST: subtract 2 hours
        // brazilOffset is -180, localOffset is 300 (for EST)
        // Brazil is at UTC-3, EST is at UTC-5
        // Difference = (-3) - (-5) = 2 hours, Brazil is 2 hours ahead
        const brazilVsLocalHours = (brazilOffsetMinutes - (-localOffsetMinutes)) / 60;
        // For EST: brazilVsLocalHours = (-180 - (-300)) / 60 = 120 / 60 = 2 hours ahead

        const today = new Date();
        let lastHour = -1;
        let dayOffset = 0;

        let match;
        while ((match = pattern.exec(html)) !== null) {
            const time = match[1];
            let title = match[2].trim()
                .replace(/&amp;/g, '&')
                .replace(/&nbsp;/g, ' ')
                .replace(/\s+/g, ' ');

            if (title.length < 3) continue;

            const [hours, minutes] = time.split(':').map(Number);

            if (lastHour !== -1 && hours < lastHour - 2) dayOffset++;
            lastHour = hours;

            // Create date and adjust for timezone difference
            const startDate = new Date(
                today.getFullYear(),
                today.getMonth(),
                today.getDate() + dayOffset,
                hours,
                minutes,
                0,
                0
            );

            // Subtract the Brazil offset to convert to user's local time
            startDate.setHours(startDate.getHours() - brazilVsLocalHours);

            const endDate = new Date(startDate);
            endDate.setHours(endDate.getHours() + 1);

            programs.push({
                id: `meuguia-${startDate.getTime()}`,
                start: startDate.toISOString(),
                end: endDate.toISOString(),
                title: title,
                description: '',
                channel_id: channelId
            });
        }

        // Fix end times
        for (let i = 0; i < programs.length - 1; i++) {
            programs[i].end = programs[i + 1].start;
        }

        return programs;
    },

    // Get current program - SIMPLE: compare with current local time
    getCurrentProgram(programs: EPGProgram[]): EPGProgram | null {
        if (programs.length === 0) return null;

        const now = Date.now();

        // Find program that's currently airing
        const current = programs.find(p => {
            const start = new Date(p.start).getTime();
            const end = new Date(p.end).getTime();
            return now >= start && now <= end;
        });

        if (current) {
            return current;
        }

        // Fallback to first program if nothing matches
        return programs[0];
    },

    // Get next program
    getNextProgram(programs: EPGProgram[]): EPGProgram | null {
        const current = this.getCurrentProgram(programs);
        if (!current) return null;

        const currentIndex = programs.findIndex(p => p.id === current.id);
        if (currentIndex >= 0 && currentIndex < programs.length - 1) {
            return programs[currentIndex + 1];
        }

        return null;
    },

    // Get upcoming programs (after current)
    getUpcomingPrograms(programs: EPGProgram[], current: EPGProgram | null, count: number): EPGProgram[] {
        if (!current || programs.length === 0) return [];

        const currentIndex = programs.findIndex(p => p.id === current.id);
        if (currentIndex < 0) return [];

        return programs.slice(currentIndex + 1, currentIndex + 1 + count);
    },

    // Format time for display (shows in local time)
    formatTime(isoString: string): string {
        const date = new Date(isoString);
        return date.toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
    },

    // Calculate progress percentage
    getProgress(program: EPGProgram): number {
        const now = Date.now();
        const start = new Date(program.start).getTime();
        const end = new Date(program.end).getTime();

        if (now < start) return 0;
        if (now > end) return 100;

        return Math.round(((now - start) / (end - start)) * 100);
    },

    // Alias for getProgress (used by LiveTV.tsx)
    getProgramProgress(program: EPGProgram): number {
        return this.getProgress(program);
    },

    // Test EPG mappings and return diagnostic information
    async testEPGMappings(sampleChannels?: string[]): Promise<{
        working: { channel: string; source: string; epgId: string; programCount: number }[];
        notWorking: { channel: string; source: string; epgId: string; reason: string }[];
        summary: { total: number; working: number; notWorking: number };
    }> {
        // Default sample channels for testing
        const testChannels = sampleChannels || [
            // USA Channels
            'USA: AMC [M]',
            'USA: CNN [M]',
            'USA: ESPN [M]',
            'USA: HBO (EAST) [M]',
            'USA: TNT [M]',
            'USA: CARTOON NETWORK (EAST) [M]',
            // Portugal Channels
            'PT: RTP 1',
            'PT: SIC',
            'PT: TVI',
            // Argentina Channels
            'ARG: TN',
            'ARG: TELEFE',
            // Brazil Channels
            'BR: Globo',
            'BR: SBT',
        ];

        const working: { channel: string; source: string; epgId: string; programCount: number }[] = [];
        const notWorking: { channel: string; source: string; epgId: string; reason: string }[] = [];

        for (const channel of testChannels) {
            // Detect source and EPG ID
            const ptId = this.getOpenEpgPortugalId(channel);
            const arId = this.getOpenEpgArgentinaId(channel);
            const usaId = this.getOpenEpgUSAId(channel);

            let source = '';
            let epgId = '';

            if (ptId) {
                source = 'Open-EPG Portugal';
                epgId = ptId;
            } else if (arId) {
                source = 'Open-EPG Argentina';
                epgId = arId;
            } else if (usaId) {
                source = 'Open-EPG USA';
                epgId = usaId;
            } else {
                source = 'mi.tv / meuguia.tv';
                epgId = 'auto-detect';
            }

            try {
                const programs = await this.fetchChannelEPG('', channel);
                if (programs.length > 0) {
                    working.push({
                        channel,
                        source,
                        epgId,
                        programCount: programs.length
                    });
                } else {
                    notWorking.push({
                        channel,
                        source,
                        epgId,
                        reason: 'Nenhum programa encontrado no EPG'
                    });
                }
            } catch (error) {
                notWorking.push({
                    channel,
                    source,
                    epgId,
                    reason: `Erro: ${(error as Error).message}`
                });
            }
        }

        return {
            working,
            notWorking,
            summary: {
                total: testChannels.length,
                working: working.length,
                notWorking: notWorking.length
            }
        };
    },

    // Get all available mappings for a specific region
    getMappingsInfo(): {
        usa: { count: number; sample: string[] };
        portugal: { count: number; sample: string[] };
        argentina: { count: number; sample: string[] };
    } {
        const usaKeys = Object.keys(openEpgUSAMappings);
        const ptKeys = Object.keys(openEpgPortugalMappings);
        const arKeys = Object.keys(openEpgArgentinaMappings);

        return {
            usa: {
                count: usaKeys.length,
                sample: usaKeys.slice(0, 10)
            },
            portugal: {
                count: ptKeys.length,
                sample: ptKeys.slice(0, 10)
            },
            argentina: {
                count: arKeys.length,
                sample: arKeys.slice(0, 10)
            }
        };
    }
};
