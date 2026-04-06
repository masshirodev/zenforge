/home/masshiro/projects/mash-cronus-scripts/dist/Mash-RainbowSixSiegeX-v1.gpc # Zen Forge — Feature Roadmap

## Deferred (Requires GPC Runtime)

These features require executing GPC code outside Cronus Zen hardware. Since we cannot build a GPC compiler/interpreter, these are parked for now. Revisit if a runtime becomes available.

- [ ] **Script Debugger** — Step-through execution with breakpoints, variable watch, call stack. Needs a GPC interpreter to trace execution.
- [ ] **Input Replay** — Record controller input sequences, replay against a script to test behavior. Needs a GPC runtime to simulate script reactions.
- [ ] **Performance Profiler** — Timing analysis of main loop iterations, combo execution cycles. Needs a GPC runtime to measure execution.
- [ ] **Unit Test Framework** — Define input/output test cases, validate against script behavior. Needs a GPC runtime to execute scripts.

## Deferred

- [ ] Add actual url to Swizzy's IDE. We won't know until it's finished. Remember to unhide (hide -> flex) the button on the build page.

## Future Ideas (Not Yet Planned)

- [ ] **Module Marketplace** — Community module browser. Publish/download modules from a curated source (GitHub repo or API). In-app browsing, install, and update.
- [ ] **Script Sharing** — One-click export of scripts/modules/combos as shareable files or links that others can import.
- [ ] **Config Profiles** — Per-game profiles (e.g., "aggressive", "stealth") that swap modules, recoil tables, and settings in one click. Extends existing profile-aware flow system to full config.

--- 

- [ ] Sprite Editor doesnt let you save, cancel, change sprites, etc.
- [ ] Write tests.
- [ ] Dont append .gpc to every single new file made within the ide, if the user adds an extension, respect it.

--- 

- [ ] Check if pagination works.
- [ ] Add a way to and maybe hide flows.json and game.json from the files tab.
- [ ] Device Monitor-like UI for input/output visualization. The one we have on ZenStudio.
- [ ] Controller support for the emulator.
- [ ] Multiple lines inputs/outputs lines per node (if press X go to N1, if press Y go to N2, etc).

- [ ] VM Speed, lets find out what this is and add it to the flow editor, a menu node that that lets ppl change it and the logic behind it. No need for a gameplay node, it will always be part of the script, the user can just add the menu node so it appears on the menu.

**[11:24 AM]VYVYDYCE:** What is the reason when I set the vm speed at a lower value, combos start to have issues, because it is unable to finish an iteration wiwthin th vm speed time limit?  

**[1:28 PM]Jblaze122:** What console are you playing on ?  

**[3:15 PM]Veritas:** in my experience we should keep the VM speed that correspond to the Console/PC  
```
10 Ms.(def)  
8 Ms.XBOX ONE  
4 Ms. PS4/PS5  
2 Ms. XBOX X/S  
1  Ms. PC  
```
```
function SetVMSpeed(){
    switch(vmSpeedIndex) {
        case 0:{
            vm_tctrl(-0);//10 ms Default
            break;
        }
        case 1:{
            vm_tctrl(-2);// 8 ms
            break;
        }
        case 2:{
            vm_tctrl(-6);// 4 ms
            break;
        }
        case 3:{
            vm_tctrl(-8);// 2 ms
            break;
        }
        case 4:{
            vm_tctrl(-9);// 1 ms
            break;
        }
    }
}
```
**[3:21 PM]Jblaze122:** PS5 output protocol can not go below 4ms on PC or Xbox. So if your playing PC and your using that protocol for another controller or using a DS5 controller you can not go below 4ms .

**[3:41 PM]Veritas:** So for XBOX X/S we are ok with 2ms?

**[3:42 PM]Jblaze122:** The lowest polling rate of an Xbox controller is 8ms . You can’t get it lower even on pc with software . They have it capped at 8ms .

**[3:44 PM]Jblaze122:** Like say your using the Xbox gamesir controller it has the 1000hz option which can only be used on pc but it outputs as an Xbox 360 controller .

**[4:11 PM]тαуℓσя∂яιƒт21:** Just to clarify though - @Jblaze122  you are right a standard xbox controller / elite controllers are capped at 8ms . But now with loads of diffrent controllers out there - most of the popular brands will work at 4ms on pc / xbox . And then for those that have a PC mode built in those can poll at 1ms on PC ( with hidusbf ) but pointless using PC mode for XBOX_ONE protocol or XBOX_360 because zen will cap it at 4ms on pc or xbox . 
However PS5 is a different story , 2ms VM speed you could use with DS5 ( there either is a bug with the FW or maybe intended ) but I thought PS5 was locked to 4ms  but appears 2ms VM speed works fine. 
One way to test it is use the rapid fire combo example in zen studio and just add vm adjustment in the example gpc - have zen connected to PS5 as you would usually do , plug the prog in zen and hightlight the inputs on R2 , start with 4ms because we know this works - hold fire for second - look at the highlight - go down to 2ms VM speed - you will see the same results - go down to 1ms that is when you will see a different result so this is a clear indication that everything works up until you get to 2ms vm speed.  
Zenlink via remote play can be used at 1ms vm speed also... not tried it without remote play but assuming it will be capped to the zen at 2ms that way.

**[4:16 PM]Jblaze122:** Yeah the issue with PS5 is with zen . It’s capped at 4ms . Easy way to tell is make a combo that will make you run forward for 10 seconds set it to 1ms on ps5. You’ll end up running forward for 40 seconds on PS5 . You can also see it in device monitor .

**[4:20 PM]Jblaze122:** If you went remote play with zen link you can do 2ms . But ps5 output protocol directly to the console or PC is capped at 4ms . Basically what happens at 1 ms or 2ms is the script speed stays at 4ms but all time functions return the vm you set and it results in anything to do with time getting longer . Like a combo wait .
  
If you sniff the packets out the console port on zen you’ll see it still only outputs at 4ms when you have it set at 1ms . It’s just the script messes up

**[4:29 PM]тαуℓσя∂яιƒт21:** @Jblaze122 Yeah so that's what I mean , you tested it via PC and the results you got sniffing the packets would give you 4ms because this is normal for the Xinput driver , what you should do though - is see what happens when you go below 4ms on PC  ( as you already mentioned you had a test combo that verified what happens if you go to 1ms and this I confirm with my test results is it slows everything down ) but you should run that combo on the zen while connected to PS5 at 2ms VM speed and output the result to the OLED display you should see the results are then correct.

**[4:34 PM]тαуℓσя∂яιƒт21:** I mean unless I did something different that wasn't as accurate as your method then of course I would stand corrected however this was something I tested for a while as I had made a script with the 1ms VM speed capabilities lol.  
I used a polling program also on PC to verify vm speeds with controllers etc and this is where I found with the DS5 connected to PC regardless of VM speed it always outputted 4ms until you used hidubf to allow it to go to 1ms (1000hz).

**[4:38 PM]Jblaze122:** 2MS use to break aswell . It was double the time . So a 10 second combo would run for 20 seconds . Device monitor would also show the combo running for 20 seconds . When I test on PS5 it would run for 20 seconds .  
  
The only way to fix it on PC was to use one of the driver overclock and force it to 1ms or 2ms on your pc . Swede tested that out and it even showed it running correctly in device monitor .

**[4:42 PM]тαуℓσя∂яιƒт21:** Ah see I didn't notice on the 2ms bro - I only noticed a big difference on the 1ms .  
I do know on PC that anything below 4ms vm speed it used to slow down too but that is kinda normal anyway given it's a driver bottleneck but hadn't noticed it on PS5 . I maybe have to run the test again sometime I get notion.  
It's all interesting stuff , btw the DS5 controller can run 8000hz with that overclocked driver ( without zen ) . That's crazy! 

**[4:45 PM]Jblaze122:** Yeah it’s nuts bro . It’s an awesome controller. Pc it can be fixed on but your playing on PS5 just don’t go below 4 .  
  
It’s pretty simple what happens . Zen sets the console and pc port to 4ms . The script runs at 4ms .  

But if you have your vm set to anything below 4ms any time function returns the reduced time but is actually running at 4ms causing everything to run longer .

**[4:47 PM]Jblaze122:** Also if your testing you can use the ps4 auth timeout timer to return seconds . It must run elsewhere on zen because that timer will stay true  and the timer say you create with a variable will be slower

**[4:49 PM]тαуℓσя∂яιƒт21:** I also noticed a while back the get_ptime() is also out a loop - not sure if you came across that

**[4:50 PM]тαуℓσя∂яιƒт21:** Say you want to do something at 300ms - it would actually return at 290ms

**[4:56 PM]Jblaze122:** Nahh I didn’t even know about that one

**[7:23 PM]Sir'm'Ice:** I have noticed that it starts from set vm value. So if it's vm 8 it will start from 8, there's your differcce  
  
--- 

**Fadexz:** Technically this is the fastest you can do on PS4/PS5, assuming you are limited by 4ms intervals. On PC technically you can use a driver to change the polling rate to 1ms (1000hz)  
```
define SPAM_MS = 4;
define FIRE = PS4_L2;

int rf_timer;
int rf_alt_toggle;

init {

    vm_tctrl(4 - 10);

}

main {
    if(get_ival(FIRE)) {
        rf_timer -= get_rtime();
        if(rf_timer <= 0) {
            rf_alt_toggle = !rf_alt_toggle;
            rf_timer = SPAM_MS;
        }
        set_val(FIRE, rf_alt_toggle * 100);
    }
    else {
        rf_alt_toggle = 0;
    }
}
```
---

**file to check:** /home/masshiro/projects/gpc-ide/temp/auto_vm_speed_calibration.gpc  
**docs about it:** [https://guide.cronus.support/gpc/MnBy-gpc-scripting-device-functions](https://guide.cronus.support/gpc/MnBy-gpc-scripting-device-functions)
