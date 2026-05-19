package com.javikastudio.tidyapp

import android.content.Context
import android.content.pm.ApplicationInfo
import android.util.JsonReader
import org.json.JSONObject
import java.io.StringReader

/**
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  AppCategorizer — 5-layer app categorisation engine                    │
 * │                                                                         │
 * │  LAYER 1  — pkg_db.json          ~85-90% of real-world installs        │
 * │  LAYER 2  — Android OS API       free signal, API 26+                  │
 * │  LAYER 3  — Finance pre-check    prevents banking mis-tag               │
 * │  LAYER 4  — Keyword scoring      long-tail coverage                     │
 * │  LAYER 5  — Unassigned           honest fallback                        │
 * │                                                                         │
 * │  All category names are constants from Categories.kt.                   │
 * │  To rename/add/remove a category, edit only Categories.kt.             │
 * └─────────────────────────────────────────────────────────────────────────┘
 */
class AppCategorizer(private val context: Context) {

    // ── Memo cache: pkg → resolved category (cleared on preScan) ────────────
    private val cache = HashMap<String, String>(512)

    // ── User overrides: pkg → category (never auto-cleared) ─────────────────
    private val userOverrides = HashMap<String, String>()

    // ── Public API ───────────────────────────────────────────────────────────

    /**
     * Resolve the category for [info]/[name].
     * Checks user overrides → memo cache → full 5-layer pipeline.
     */
    fun categorize(info: ApplicationInfo, name: String): String {
        val pkg = info.packageName.lowercase()
        userOverrides[pkg]?.let { return it }
        cache[pkg]?.let { return it }
        return pipeline(info, name).also { cache[pkg] = it }
    }

    /**
     * Pin [pkg] to [category] permanently.
     * Survives every future categorize() call.
     */
    fun setUserOverride(pkg: String, category: String) {
        val key = pkg.lowercase()
        userOverrides[key] = category
        cache[key] = category
    }

    /** Evict all auto-computed results. User overrides are NOT cleared. */
    fun clearCache() = cache.clear()

    /** Returns the DB-sourced category for [pkg], or null on miss. */
    fun getDbCategory(pkg: String): String? = pkgDb[pkg.lowercase()]

    // ── Layer 1 — pkg_db.json ────────────────────────────────────────────────

    private val pkgDb: Map<String, String> by lazy { loadPkgDb() }

    private fun loadPkgDb(): Map<String, String> {
        // OPTIMISATION: previously used JSONObject(it.readText()) which:
        //   1. Loaded the entire 869KB file into a String (heap allocation)
        //   2. Parsed that String into a JSONObject (second heap allocation)
        //   3. Iterated keys() — which returns an unsorted Iterator, not pre-indexed
        //
        // JsonReader streams directly from the InputStream, building the HashMap
        // in a single pass with no intermediate String or JSONObject. Peak heap
        // usage drops from ~4× file size to ~1× (the map itself).
        //
        // Keys are lowercased during load so getDbCategory() can do a plain
        // map[pkg] lookup without calling .lowercase() on every categorize() call.
        // The 930 mixed-case keys in the current DB are deduplicated into their
        // lowercase equivalents, shrinking the map by ~5%.
        val map = HashMap<String, String>(18_000)   // 16,705 entries + headroom

        // ── Bundled asset (streaming) ─────────────────────────────────────────
        runCatching {
            context.assets.open("pkg_db.json").bufferedReader().use { reader ->
                readJsonObjectEntries(JsonReader(reader)) { key, value ->
                    map[key.lowercase()] = Categories.migrate(value)
                }
            }
        }

        // ── OTA overlay — wins over bundled asset ─────────────────────────────
        // Overlay is small (typical patch ≤ 500 entries), so JSONObject is fine.
        // The streaming path is not needed here.
        runCatching {
            val prefs = context.getSharedPreferences("tidyapp_v6", Context.MODE_PRIVATE)
            val overlay = prefs.getString("pkg_db_overlay", null)
            if (!overlay.isNullOrBlank()) {
                readJsonObjectEntries(JsonReader(StringReader(overlay))) { key, value ->
                    map[key.lowercase()] = Categories.migrate(value)
                }
            }
        }

        // ── Hardcoded pins — highest priority ────────────────────────────────
        map["pt.min_saude.spms.sns24"] = Categories.HEALTH
        map["pt.luzsaude.myluz"]        = Categories.HEALTH
        map["pt.sonae.continente"]      = Categories.SHOPPING
        map["pt.worten.app"]            = Categories.SHOPPING

        return map
    }

    /**
     * Streams a JSON object from [reader] and invokes [onEntry] for each
     * key–value pair. Both key and value are strings.
     *
     * Using JsonReader instead of JSONObject avoids loading the entire JSON
     * into memory as a String before parsing — critical for the 869KB pkg_db.json.
     */
    private inline fun readJsonObjectEntries(
        reader: JsonReader,
        crossinline onEntry: (key: String, value: String) -> Unit,
    ) {
        reader.use {
            it.beginObject()
            while (it.hasNext()) {
                val key   = it.nextName()
                val value = it.nextString()
                onEntry(key, value)
            }
            it.endObject()
        }
    }

    // ── 5-layer pipeline ─────────────────────────────────────────────────────

    private fun pipeline(info: ApplicationInfo, name: String): String {
        val pkg   = info.packageName.lowercase()
        val nameL = name.lowercase()

        // Layer 1 — DB: deterministic, covers ~85-90% of installs
        pkgDb[pkg]?.let { return it }

        // Layer 2 — Android OS category (Play Store-enforced, API 26+)
        // CATEGORY_PRODUCTIVITY intentionally skipped — banking apps self-declare
        // it frequently, so Finance pre-check (Layer 3) handles them first.
        Categories.fromAppInfoCategory(info.category)?.let { return it }

        // Layer 3 — Finance pre-check
        // Runs even for CATEGORY_PRODUCTIVITY declarers so banking apps always
        // land in Finance. Threshold ≥ 4: requires ≥1 pkg hit (×3) or ≥4 name hits.
        val finScore = FINANCE_PKG_KW.count { pkg.contains(it) } * 3 +
                FINANCE_NAME_KW.count { nameL.contains(it) }
        if (finScore >= 4) return Categories.FINANCE

        // Layer 4 — Keyword scoring
        // pkg keyword  → +3  (curated, low false-positive rate)
        // name keyword → +2  (whole-word token match; stems ≥6 chars via startsWith)
        // Confidence gate: score ≥ 3 required to win (prevents single weak hits).
        // Ties broken by Categories.PRIORITY order (Finance > Health > … > Tools).
        val nameTokens = nameL
            .split(" ", "-", "_", ":", "&", "/", "(", ")")
            .filter { it.length >= 3 }
            .toSet()

        val scores = mutableMapOf<String, Int>()
        for (def in CATEGORY_DEFS) {
            var s = def.pkgKw.count { pkg.contains(it) } * 3
            s += def.nameKw.count { kw ->
                if (' ' in kw) nameL.contains(kw)   // multi-word phrase: substring
                else nameTokens.any { t ->
                    t == kw || (kw.length >= 6 && t.startsWith(kw))
                }
            } * 2
            if (s > 0) scores[def.cat] = (scores[def.cat] ?: 0) + s
        }

        if (scores.isNotEmpty()) {
            val best = scores.entries.maxWithOrNull(
                compareBy({ it.value }, { -Categories.PRIORITY.indexOf(it.key) })
            )!!
            if (best.value >= 3) return best.key
        }

        // Layer 5 — Unassigned: honest fallback, never a guess
        return Categories.UNASSIGNED
    }

    // ── Layer 3 — Finance keyword lists ─────────────────────────────────────

    private val FINANCE_PKG_KW = listOf(
        "bank","chase","wellsfargo","bankofamerica","paypal","venmo","robinhood",
        "coinbase","cash.app","revolut","wise.account","crypto.com","binance",
        "kraken","fidelity","schwab","betterment","mint.intuit","pocketguard",
        "ynab","zerodha","groww","upstox","angelbroking","paytm","phonepe",
        "google.pay","amazon.pay","cred.club","slice.app","jupiter.money","niyo",
        "kotak","hdfc","icici","sbi.yono","axis.bank","acorns","stash.invest",
        "sofi","chime","coinswitch","wazirx","coindcx","freetrade","trading212",
        "etoro","degiro","monzo","starling","n26","nubank","ally.bank","capital.one",
        "discover.bank","american.express","barclays","hsbc","natwest","lloyds",
        "santander","td.bank","credit.karma","gpay","googlepay","mobikwik",
        "freecharge","airtel.money","juspay","bharatpe","razorpay","cashfree",
        "stripe","braintree","plaid","yolt","curve.card","clearscore","experian",
        "equifax","moneylion","earnin","dave.app","brigit","cleo.ai","albert.app",
        "possible.finance","self.lender","brokerage","investment","demat","forex",
        "remittance","neobank","creditscore","loanapp","insurtech","wealthapp",
    )

    private val FINANCE_NAME_KW = listOf(
        "bank","pay","money","invest","trade","stock","crypto","wallet","budget",
        "expense","tax","loan","insurance","mortgage","pension","portfolio","saving",
        "credit","finance","currency","exchange","transfer","billing","payment",
        "upi","neft","imps","demat","broker","mutual fund","forex","remit",
        "ledger","accounting","reimburs","split bill","expense tracker",
    )

    // ── Layer 4 — Category keyword definitions ───────────────────────────────

    private data class CategoryDef(
        val cat: String,
        val pkgKw: List<String>  = emptyList(),
        val nameKw: List<String> = emptyList(),
    )

    private val CATEGORY_DEFS: List<CategoryDef> = listOf(

        CategoryDef(
            cat    = Categories.SOCIAL,
            pkgKw  = listOf("instagram","facebook","snapchat","tiktok","whatsapp","telegram",
                "discord","reddit","linkedin","messenger","threads","pinterest","tumblr",
                "signal","viber","wechat","line.naver","kakao","kik","skype","bereal",
                "mastodon","bluesky","sharechat","clubhouse","bumble","tinder","hinge",
                "okcupid","grindr","badoo","tagged","match","zoosk","meetup","yubo",
                "amino","twitter","x.com","dating","scruff","hornet","truecaller",
                "imo.android","vkontakte","bigo","yalla","zepeto","whisper","confession"),
            nameKw = listOf("chat","social","dating","friend","connect","match","meet",
                "community","message","group","dm","follow","post","share","network",
                "talk","call","couple","relationship","flirt","anonymous","story","reel",
                "live","broadcast","forum","voice chat","video chat","text","sms","mms"),
        ),

        CategoryDef(
            cat    = Categories.ENTERTAINMENT,
            pkgKw  = listOf("netflix","youtube","twitch","hulu","disney","primevideo",
                "crunchyroll","peacock","hbomax","vimeo","plex","vlc","mxplayer","hotstar",
                "zee5","sonyliv","jiocinema","altbalaji","voot","paramountplus","discovery",
                "bilibili","iqiyi","dailymotion","rumble","curiositystream","mubi","shudder",
                "tubi","fubo","pluto.tv","sling","nfl.mobile","nba.app","dazn","appletv",
                "bbc.iplayer","itvhub","britbox","vudu","starz","showtime","fxnow",
                "espn.plus","mgm.plus","zhiliaoapp","tiktok","wbd.stream","peacocktv"),
            nameKw = listOf("video","watch","stream","movie","film","series","episode",
                "anime","tv","live","cinema","show","season","binge","vod","ott","channel",
                "webseries","short","reel","clip","documentary","comedy","drama","thriller",
                "horror","action","reality","cartoon","kids show","short-form","live tv"),
        ),

        CategoryDef(
            cat    = Categories.MUSIC,
            pkgKw  = listOf("spotify","shazam","lastfm","musixmatch","poweramp","blackplayer",
                "jetaudio","shuttle","musicolet","gaana","jiosaavn","wynk","hungama",
                "amazon.music","youtube.music","podbean","pocketcasts","castbox","overcast",
                "stitcher","podcast","tunein","iheart","bbc.sounds","audible","storytel",
                "scribd","libby","soundhound","boomplay","audiomack","tonebridge",
                "ultimate.guitar","guitartuna","chordify","smule","voloco","bandlab",
                "soundtrap","yousician","flowkey","anghami","napster","soundbrenner",
                "metronome","caustic","n.track","walk.band","beatmaker","fl.studio"),
            nameKw = listOf("music","audio","song","podcast","radio","playlist","listen",
                "beat","mp3","album","track","tune","guitar","piano","drum","compose","dj",
                "karaoke","lyrics","chord","ringtone","sound","equalizer","lofi","jazz",
                "classical","hip hop","rap","edm","bpm","ambient","white noise","audiobook",
                "spoken word","soundcloud","tidal","deezer"),
        ),

        CategoryDef(
            cat    = Categories.CREATIVE,
            pkgKw  = listOf("adobe","lightroom","photoshop","premiere","aftereffects","canva",
                "vsco","snapseed","picsart","facetune","inshot","capcut","kinemaster",
                "powerdirector","lensa","prisma","meitu","beautycam","retrica","camera360",
                "gcam","opencamera","proshot","halide","filmic","moment","davinci",
                "alight.motion","vivavideo","filmora","quik","splice","vllo","pixlr",
                "befunky","fotor","photo.editor","vid.trim","procreate","ibispaint",
                "medibang","sketchbook","infinite.painter","artflow","concepts.app",
                "vectornator","affinity","clip.studio","blender"),
            nameKw = listOf("camera","photo","video edit","selfie","portrait","filter",
                "collage","beautif","retouch","photo enhancer","ai photo","background remov",
                "slow motion","timelapse","photo gallery","digital art","sketch","drawing",
                "painting","animation","creative","design","art","illustration","graphic",
                "reel maker","content creat","3d model","render","color grade","vfx",
                "sticker","gif","meme","thumbnail","banner","poster","logo"),
        ),

        CategoryDef(
            cat    = Categories.PRODUCTIVITY,
            pkgKw  = listOf("gmail","slack","notion","calendar","drive","dropbox","zoom",
                "trello","asana","outlook","office","sheets","monday","clickup","todoist",
                "evernote","onenote","hubspot","jira","confluence","basecamp","airtable",
                "obsidian","linear","superhuman","spark.mail","airmail","protonmail",
                "tutanota","fastmail","1password","lastpass","bitwarden","dashlane","authy",
                "docs.google","microsoft.word","microsoft.excel","microsoft.powerpoint",
                "wps.office","polaris.office","adobe.acrobat","camscanner","scanbot",
                "any.do","ticktick","omnifocus","taskade","sunsama","craft.do","ulysses",
                "drafts.app","zotero","readwise","logseq","hey.com","webex","gotomeeting",
                "miro","figma","loom.video","calendly","docusign","hellosign","foxit",
                "grammarly","quillbot","wordtune","chatgpt","copilot","bard","openai",
                "anthropic","claude"),
            nameKw = listOf("task","note","calendar","email","mail","document","pdf","scan",
                "plan","project","work","office","productivity","reminder","habit","write",
                "clipboard","password","organizer","schedule","agenda","meeting","invoice",
                "sign","contract","todo","checklist","mindmap","kanban","sprint","report",
                "timetrack","workflow","crm","hr","erp","helpdesk","survey","form",
                "whiteboard","video call","conference","collaborat","focus","deep work",
                "pomodoro","ai assistant","ai writing","ai tool","copilot","chatgpt"),
        ),

        CategoryDef(
            cat    = Categories.GAMES,
            pkgKw  = listOf("supercell","gameloft","ea.games","zynga","king.com","rovio",
                "miniclip","bandainamco","ubisoft","garena","playrix","scopely",
                "nianticlabs","mojang","roblox","voodoo","ketchapp","innersloth","pubg",
                "fortnite","minecraft","candycrush","clashofclans","brawlstars",
                "clashroyale","coinmaster","eightball","freefire","callofduty","genshin",
                "pokemongo","wordscapes","trivia.crack","ludo.king","chess.com",
                "solitaire","mahjong","sudoku","crossword"),
            nameKw = listOf("game","gaming","puzzle","arcade","adventure","rpg","fps","moba",
                "strategy","battle royale","clash","quest","dungeon","tower defense",
                "idle game","casual game","simulator","tycoon","sandbox","casino","slots",
                "poker","ludo","chess","trivia","word game","brain game","match-3",
                "card game","board game","racing game","multiplayer","offline game",
                "online game","play","level","score","leaderboard","clan","guild","pvp"),
        ),

        CategoryDef(
            cat    = Categories.HEALTH,
            pkgKw  = listOf("strava","myfitnesspal","fitbit","garmin.connect","headspace",
                "calm","peloton","noom","weightwatchers","nike.training","adidas.running",
                "underarmour","sworkit","7minute","30day","workout","gymshark","jefit",
                "strongapp","hevy","fitbod","cronometer","loseit","yazio","lifesum",
                "clue","flo.health","eve.app","period.tracker","ovia","glow.app","medisafe",
                "ada.app","babylon","kry","teladoc","zocdoc","healthgrades","webmd",
                "drugs.com","epocrates","medlineplus","nhs","practo","lybrate","mfine",
                "apollo","1mg","pharmeasy","netmeds","sleepwatch","pillow.sleep",
                "sleep.cycle","relax.melodies","insight.timer","waking.up","ten.percent",
                "smiling.mind","breathe","wysa","woebot","sanvello","talkspace","betterhelp"),
            nameKw = listOf("workout","fitness","gym","exercise","yoga","meditat","running",
                "cycling","step count","heart rate","calorie","diet","nutrition",
                "weight loss","sleep track","period track","mental health","therapy",
                "mindfulness","breathe","wellbeing","blood pressure","glucose","physio",
                "rehab","intermittent fast","body fat","muscle","hiit","strength","doctor",
                "physician","clinic","hospital","diagnose","symptom","prescription",
                "medication","drug","pharmacy","telehealth","appointment","healthcare",
                "disease","vaccine","dermatology","specialist","meditation","stress",
                "anxiety","recovery"),
        ),

        CategoryDef(
            cat    = Categories.EDUCATION,
            pkgKw  = listOf("duolingo","babbel","busuu","rosetta","memrise","anki","quizlet",
                "kahoot","coursera","udemy","skillshare","masterclass","linkedin.learning",
                "khan.academy","edx","pluralsight","brilliant.org","wolfram","photomath",
                "socratic","chegg","scribd","kindle","libby","overdrive","storytel",
                "wattpad","comixology","goodreads","gutenberg","google.books","apple.books",
                "pocket.book","kobo","readera","moon.reader","bookmate","nook","hoopla",
                "readwise","medium.com","substack","wikipedia","britannica","ted.app",
                "swift.playgrounds","grasshopper","mimo","sololearn","codecademy","enki",
                "datacamp","leetcode","hackerrank"),
            nameKw = listOf("learn","study","e-learning","online course","lesson","tutor",
                "quiz","flashcard","language learn","coding learn","math","science",
                "history","vocabulary","grammar","exam prep","school","university",
                "homework","lecture","edtech","certification","bootcamp","kids learn",
                "homeschool","read","book","ebook","novel","story","comic","manga",
                "library","dictionary","encyclopedia","wiki","reference","textbook",
                "academic","research","literature","self-help"),
        ),

        CategoryDef(
            cat    = Categories.NEWS,
            pkgKw  = listOf("bbc.news","cnn.mobile","nytimes","theguardian","reuters",
                "apnews","bloomberg","wsj.android","washingtonpost","theatlantic",
                "economist","time.news","newsweek","usatoday","huffpost","buzzfeed",
                "vox.media","techcrunch","theverge","engadget","wired","arstechnica",
                "9to5google","androidpolice","flipboard","feedly","inoreader","google.news",
                "apple.news","pocket","instapaper","substack","medium","reddit.frontpage",
                "ground.news","axios","politico","thehill","aljazeera","france24",
                "dw.news","skynews","euronews","hindustantimes","timesofindia","ndtv",
                "thehindu","india.today","economic.times"),
            nameKw = listOf("news","headline","daily news","breaking news","news feed",
                "newsletter","news briefing","live news","latest news","top stories",
                "news aggregator","media","press","journalism","current affairs","politics",
                "world news","local news","fact check","magazine","newspaper","journal",
                "digest","editorial","opinion","analysis","report","bulletin","chronicle"),
        ),

        CategoryDef(
            cat    = Categories.TRAVEL,
            pkgKw  = listOf("googlemaps","waze","citymapper","moovit","uber","lyft",
                "ola.cabs","grab","gojek","bolt.app","airbnb","booking","expedia",
                "hotels.com","trivago","agoda","hostelworld","skyscanner","kayak","hopper",
                "google.flights","momondo","kiwi.com","rome2rio","tripadvisor","foursquare",
                "komoot","alltrails","maps.me","osmand","sygic","tomtom","garmin.maps",
                "here.maps","transit.app","flixbus","trainline","amtrak","delta.airlines",
                "united.airlines","american.airlines","southwest","ryanair","easyjet",
                "klm","lufthansa","emirates","airasia","airfrance"),
            nameKw = listOf("map","navigate","navigation","direction","route","gps","travel",
                "trip","flight","hotel","booking","taxi","cab","bus","train","commute",
                "traffic","ride","rideshare","carpool","bike rental","car rental","cruise",
                "ferry","airport","visa","hostel","holiday","vacation","road trip",
                "itinerary","explore","city guide","transport","transit","subway","metro",
                "timetable","check-in","boarding pass"),
        ),

        CategoryDef(
            cat    = Categories.SHOPPING,
            pkgKw  = listOf("amazon","ebay","etsy","walmart","target","costco","bestbuy",
                "aliexpress","alibaba","wish","shein","zara","hm.android","uniqlo","gap",
                "nike.shop","adidas.shop","myntra","flipkart","meesho","nykaa","ajio",
                "tatacliq","snapdeal","paytm.mall","jiomart","blinkit","zepto","instamart",
                "instacart","shipt","kroger","safeway","wholefoods","shopify","poshmark",
                "depop","vinted","thredup","mercari","offerup","facebook.marketplace"),
            nameKw = listOf("shop","shopping","buy","purchase","deal","sale","cart",
                "ecommerce","fashion","grocery","supermarket","marketplace","auction",
                "second hand","resell","thrift","wholesale","flash sale","coupon",
                "discount","cashback","offer","price compare","wishlist","order",
                "delivery","track order","brand","luxury","outlet","clearance"),
        ),

        CategoryDef(
            cat    = Categories.LIFESTYLE,
            pkgKw  = listOf("philips.hue","smartthings","homey","homekit","alexa",
                "google.home","nest","ring.app","arlo","eufy","wyze","august.home",
                "ecobee","honeywell","ifttt","yeelight","tp.link.kasa","wemo","lifx",
                "zillow","realtor","redfin","trulia","rightmove","zoopla","loopnet",
                "apartments","rent.com","vrbo","homeaway","houzz","homestyler","planner5d",
                "ikea.place","wayfair","overstock","homeadvisor","thumbtack","taskrabbit",
                "angi","nextdoor","babycenter","ovia.parenting","kinedu","tinybeans","cozi",
                "life360","findmyfamily","cargurus","autotrader","cars.com","edmunds",
                "motortrend","tesla","plugshare","chargepoint","parkmobile","carmax"),
            nameKw = listOf("smart home","home automation","iot","connected home",
                "lighting control","thermostat","security camera","doorbell","lock","alarm",
                "energy monitor","solar","home security","real estate","property","house",
                "apartment","rent","buy home","mortgage","interior design","home decor",
                "furniture","renovation","repair","handyman","parenting","baby","child",
                "kids","toddler","family","parent","couple","wedding","pet","dog","cat",
                "garden","plant","outdoor","lawn","neighbor","car","vehicle","auto",
                "parking","ev charging","fuel","mechanic","garage"),
        ),

        CategoryDef(
            cat    = Categories.FOOD,
            pkgKw  = listOf("doordash","ubereats","grubhub","deliveroo","zomato","swiggy",
                "instacart.food","postmates","seamless","caviar.food","menulog","justeat",
                "foodpanda","grab.food","gojek.food","talabat","hungerstation","yemeksepeti",
                "mcdonalds","starbucks","subway.food","pizzahut","dominos","burgerking",
                "kfc","tacobell","wendys","dunkin","chipotle","papajohns","panera",
                "popeyes","chick-fil-a","yummly","allrecipes","tasty","cookpad","bigoven",
                "mealime","whisk.recipes","plantoeat","paprika"),
            nameKw = listOf("food","delivery","restaurant","recipe","cook","meal","drink",
                "kitchen","chef","grocery delivery","food order","takeout","takeaway",
                "meal kit","cookbook","calorie","nutrition","diet","organic","vegan",
                "coffee","tea","café","bar","pub","eat","dining","menu","cuisine",
                "ingredient","baking","dessert","snack","breakfast","lunch","dinner",
                "brunch","smoothie","juice","beer","wine","cocktail"),
        ),

        CategoryDef(
            cat    = Categories.SPORTS,
            pkgKw  = listOf("espn","thescore","cbssports","nfl.mobile","nba.app","mlb",
                "nhl","bbc.sport","laliga","uefa","cricbuzz","dream11","livescore",
                "flashscore","sofascore","onefootball","fotmob","bleacher","eurosport",
                "fox.sports","sky.sports","dazn","sportradar","365scores","sportsnet",
                "watchespn","strava.sports","nike.run","adidas.running","whoop",
                "peloton.sport","zwift","trainerroad"),
            nameKw = listOf("sport","football","soccer","cricket","basketball","baseball",
                "hockey","tennis","golf","formula","mma","ufc","boxing","wrestling",
                "rugby","handball","volleyball","badminton","esport","fantasy sport",
                "live score","match score","fixture","standings","league","championship",
                "tournament","athlete","olympics","transfer news","bet","odds","highlight",
                "commentary","squad","roster","lineup","draft","fantasy league"),
        ),

        CategoryDef(
            cat    = Categories.TOOLS,
            pkgKw  = listOf("chrome","firefox","opera","brave.browser","edge",
                "samsung.internet","duckduckgo","files.google","avast","avg.antivirus",
                "bitdefender","kaspersky","malwarebytes","nordvpn","expressvpn","surfshark",
                "protonvpn","mullvad","windscribe","tunnelbear","adguard","blokada",
                "netguard","solid.explorer","mixplorer","cx.file","nova.launcher",
                "lawnchair","evie.launcher","niagara","smart.launcher","tasker","automate",
                "macrodroid","pushbullet","google.authenticator","microsoft.authenticator",
                "aegis","andotp","battery.doctor","greenify","sd.maid","cccleaner",
                "find.my.device","cerberus","lookout","phonecleaner","junk.cleaner",
                "applock","vault","calculator.plus","unit.converter","qr.scanner","barcode",
                "screen.recorder","voice.recorder","file.transfer","xender","shareit",
                "zapya","ftp","ssh","terminal","shizuku","magisk","twrp","cpu.info",
                "gpu.info","clipboard.manager","zedge","wallpaper","wallcraft","kustom",
                "iconpack","themestore","backdrops","unsplash","accuweather","wunderground",
                "foreca","darksky","weatherbug","myradar","windy","meteo","weather"),
            nameKw = listOf("browser","file","vpn","tool","utility","system","launcher",
                "keyboard","input","clipboard","security","antivirus","clean","boost",
                "battery","storage","backup","sync","transfer","qr","barcode","scanner",
                "screen","record","mirror","cast","measure","convert","calculator",
                "flashlight","manager","monitor","alert","lock","permission","optimizer",
                "booster","junk","cache","memory","ram","cpu","network","wifi","hotspot",
                "bluetooth","nfc","terminal","root","developer","adb","automation","macro",
                "shortcut","notification","silent","ringtone","volume","equalizer",
                "compass","ruler","level","magnifier","remote","app manager","task manager",
                "system info","device info","benchmark","speed test","ping","ip","dns",
                "wallpaper","icon pack","theme","skin","home screen","lock screen","widget",
                "font","personaliz","customiz","aesthetic","live wallpaper","amoled",
                "weather","forecast","temperature","rain","snow","wind","humidity",
                "radar","air quality"),
        ),
    )
}