Proper description with pretty pictures TBD.

### Nodes 2.0 front-end fix for rgthree-comfy.
-  currently only Fast Node Bypass and Mute are fixed.
-  Next is Seed and Label.
-  each part toggleable in ComfyUI settings encase the fix breaks.

This is only a front-end patch, you must install rgthree-comfy separately if you want it.
 
### Super-Power LoRA Loader:
A loRA loader for crazy people with lots of loRAs, to effectively manage their horde of loRAs. *still in beta, so some things may change, but it should be just how functions are displayed rather than any fictionality additions or changes, feel free to throw in your 2 cents.* 
  
-  Add individual LoRAs, folders or folder trees with an initial import wizard, which can be accessed in setting after setup. 
-  Imported folder trees duplicated in group trees.
-  Move about loras in GROUPS without changing the files location.
-  new LoRAs added to a folder or folder tree will automatically be imported after refreshing comfyUI or pressing the Rescan Folders button, if a group exists with a matching folder location will get added to the group.
-  Search all imported loras or individual groups.
-  Create Favouritew and Mixes to more efficiently switch between loras.
-  Enabled LoRA history for quickly enabling loras you have used recently. 
-  Automagically condenses down if you make make the node narrow.
-  Collapse the groups section to make it even smaller to fit in with your workflow.
-  A fair amount of customisation available most of which can be changed from the setting. 
-  Group/List toggle: switch between grouped and flat list.

PS: I think I hyper-focused in on this one and created a monster, in a good way, I think... well for anyone with like 15+ loras for a model, otherwise the extra functions can get in the way as much, as I have tried to reduce that, at that point I suggest rgtree's Power Lora Loader instead, which was my go to before—hence the name—but gets way too unwieldy when working with a more than I would say 15+ loras.

### TabbedNote:
  A tabbed note node... dur. *still in late beta, so some minor things might change, again feel free to throw in your 2 cents.*
Okay... well you can switch each tab between a modes, Plain, Markdown Note, or Tag List.
Note and Markdown notes work like stock, except, well in tabs.
-  Tag list creates chips from your tags list which you just click on to copy, clicking a sub-headline—formatted while editing as '##sub-headline_name' —will copy all tags under the sub-headline, clicking on a chip will copy the clicked on chip, formatting guide in any empty markdown note or Tag list.
-  Colourisable  the tabs, add tabs to groups, collapse the groups, and colourise groups.
-  Also click on setting the "..." and set it to be able to be used as a tabbed text prompt, by default it will use the current tab as the text prompt, you can set a default tab to use as the output.
-  You can also set it to dump a prompt into a tab automatically by enabling the "Text input" and connecting in text from your prompt node.

The last 2 seem kinda gimmicky if you ask me, hence why it's berried in a settings menu you shouldn't really have to touch otherwise. 

PS: Nice if you find yourself plastering a bunch of notes and markdown notes on your workflows and creating a mess, or if you are tired of arranging you literality of notes and markdown notes, also for Anima, illustrious and also maybe MOSS Image for keeping your go to danbooru tags organised.

-  Plan to add shift+click to copy multiple tags as I forgot about that one. 

  *Gets a lot less complicated, but much more boring and niche here for sure, so in order of least boring and niche.*

### Resolution Picker:
  set megapixel, aspect ratio, orientation and divisible by, with live output resolution preview, there is a node out there that is basically this minus the orientation, but I find a separate orientation setting to be useful, allows for more aspect ratios in a shorter list.
-Included aspect ratios: 1:1, 5:4, 4:3, 1.414:1, 3:2, 5:3, 16:9, 2:1, 21:9, 2.39:1, 3:1.

### Seed History: 
Find yourself realising you had a good seed, but now you have lost it, feed your seed into this node and keep a history, so you never have to regret losing a seed again. *Will likely add a combined seed generator with history.*

### Sigmas at Step:
Useful for nodes that use a sigmas value to activate or deactivate in an intuitive manner.

### Sigmas at Percent:
Same as sigmas at step, but this time with percentages, actually less useful, but I created it so... why not add it, someone might find a use case where it's more useful.

### Force Changed
Useful when you have stateful nodes which don't reset on completion of the generation, literally the only reason for this node, but when it comes in handy, it's so handy. Just wire it in before the stateful node and it will registerer the text or seed change and force an is_changed for everything after the node.

*All nodes made with Claude so if you don't like AI, it's fine, just don't use it, but I will say that I have spent like 14 roads of coding with Claude to get the lora loader how I like it, and I think 6 for the tabbednote, so it's not just AI slop. IT'S REFINED AI SLOP, DAMMIT!*
