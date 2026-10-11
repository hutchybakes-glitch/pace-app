// What a runner means mid-run, without the laptop: plain keyword rules, used when the laptop coach can't
// be reached (or is too slow), so the in-run assistant always works. The AI coach on the laptop gives the
// same six intents. No DOM: runs under node --test.
export const INTENTS=['slower','faster','hold','status','pain','none'];
export const INTENT_LABEL={slower:'Slower',faster:'Faster',hold:'Hold this pace',status:'How am I doing?',pain:'Something hurts',none:'Not sure'};

// Checked in this order: pain first (safety), then questions, then the rest. A negation flips "easy".
const RULES=[
  ['pain',/\b(pain|painful|hurts?|hurting|injur\w*|cramp\w*|stitch|twinge\w*|pulled|strain\w*|niggle\w*|sharp|killing me|ache|aching|limp\w*|twisted|rolled my)\b/],
  ['status',/\b(how am i|how('?s| is) (it|my|this) going|how('?m| am) i doing|what('?s| is) my|my (pace|time|split|distance)|how far|how much (further|left|more)|how long|distance|ahead|behind|status|where am i|am i on (track|target|pace))\b/],
  ['slower',/(struggl\w*|too (hard|fast|quick)|slow (it |this |me )?down|slower|ease (it |this )?(off|up|back)|easier|tired|knackered|exhausted|shattered|dying|dead legs|can'?t (hold|keep|breathe|do)|blowing|hanging on|hard work|back off|gassed|heavy legs|not easy|isn'?t easy|too much|need a break|done in)/],
  ['faster',/(too (easy|slow)|faster|quicker|speed (it |this )?up|push (me|it|on)?|pick (it |this )?up|feel(ing)? (good|great|strong|fresh)|harder|step it up|more pace|bit more|go for it|let'?s go|not hard|isn'?t hard|easy peasy)/],
  ['hold',/\b(keep (it|this|going)|hold (it|this|the pace)?|stay (like this|here|at this)|this is (fine|good|ok|okay|right|perfect)|that'?s (fine|good|right|perfect)|happy|perfect|just right|spot on|steady)\b/],
];
// text -> {intent, rule}: the first rule that matches ('none' if nothing does)
export function matchIntent(text){
  const t=String(text||'').toLowerCase().replace(/[’]/g,"'");
  for(const [intent,re] of RULES)if(re.test(t))return {intent,rule:re.source.slice(0,30)};
  return {intent:'none',rule:null};
}
