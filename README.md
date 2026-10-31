Proper description with pretty pictures TBD.

### Nodes 2.0 front-end patch for rgthree-comfy.
Why bother with nodes 2.0, is it because I am simply blown away with the aesthetic... no. 

Cutting a long story short I believe when dealing with a lot of block swapping like when running a video model with a relative to the model size low VRAM card when you consider the size of the attention layers ontop of the model, I have found in my experience that nodes 2.0 can actually offer a generation speed advantage and will have far less lags, it will be lower FPS than the classic canvas on average, but hitches are so much more annoying than low FPS for a UI. probably has something to do with nodes 2.0 drawing everything and then only redrawing what changes rather than redrawing everything if you move the canvas.

-  Added a gear icon for settings to nodes where it made sense.
-  added multiple choice to setting where it made sense, rather than having to type out things where there were limited choices.
-  each node is togglable in ComfyUI settings encase the fix breaks.

Gear icon was added because properties is a blocked term for Nodes 2.0, did also add a Node Properties to the right click menu, but it gets berried half way down the right click menu, so using the dead space next to the source badge was an easy choice.

PS: This is only a front-end patch only, you must install [rgthree-comfy](https://github.com/rgthree/rgthree-comfy) separately if you want it, if you want the patch only it should be possible to take the `__init__.py` and `web/rgthree_nodes2_fix/...` and putting it in a folder in your custom nodes. designed so that if the patch breaks it wont break classic canvas, but s£$% happens so.
 
### Super-Power LoRA Loader:
A loRA loader for crazy people with lots of loRAs, to effectively manage their horde of loRAs. *still in beta, so some things may change, but it should be just how functions are displayed rather than any fictionality additions or changes, feel free to throw in your 2 cents.* 
  
-  Add individual LoRAs, folders or folder trees with an initial import wizard, which can be accessed in setting after setup. 
-  Imported folder trees duplicated in group trees.
-  Move about loras in GROUPS without changing the files location.
-  new LoRAs added to a folder or folder tree will automatically be imported after refreshing comfyUI or pressing the Rescan Folders button, if a group exists with a matching folder location will get added to the group.
-  Search all imported loras or individual groups.
-  Create Favourites and Mixes to more efficiently switch between loras.
-  Enabled LoRA history for quickly enabling loras you have used recently. 
-  Automagically condenses down if you make the node narrow.
-  Collapse the groups section to make it even smaller to fit in with your workflow.
-  A fair amount of customisation available most of which can be changed from the setting. 
-  Group/List toggle: switches between grouped and a flat list.

PS: I think I hyper-focused in on this one and created a monster, in a good way, I think... well for anyone with like 15+ loras for a model, otherwise the extra functions can get in the way—much as I have tried to reduce that—at that point I suggest rgtree's Power Lora Loader instead, which was my go to before—hence the name—but gets way too unwieldy when working with a more than I would say ~15+ loras.

### TabbedNote:
  A tabbed note node... dur. *still in late beta, so some minor things might change, again feel free to throw in your 2 cents.*
Okay... well you can switch each tab between 3 modes, Plain, Markdown Note, or Tag List. Plain and Markdown notes work like stock notes and markdown notes, except, well in tabs.
-  Tag list creates chips from your tags list.
-  Clicking a chip will copy the tag to clipboard.
-  Shift hold+click to copy multiple chips.
-  Clicking a sub-headline will copy all the chips under it.
-  Clicking a headline will copy all chips in all sub-headlines under it. 
-  Colourisable the tabs, add tabs to groups, collapse the groups, and colourise groups.
-  Also click on setting the "..." and set it to be able to be used as a tabbed text prompt, by default it will use the current tab as the text prompt, you can set a default tab to use as the output.
-  You can also set it to dump a prompt into a tab automatically by enabling the "Text input" and connecting in text from your prompt node.

The last 2 seem kinda gimmicky if you ask me, hence why it's berried in a settings menu you shouldn't really have to touch otherwise. 

PS: Nice if you find yourself plastering a bunch of notes and markdown notes on your workflows and creating a mess, or if you are tired of arranging you literality of notes and markdown notes, also for Anima, illustrious and also maybe MOSS Image for keeping your go to danbooru tags organised.

  *Gets a lot less complicated, but much more boring and/or niche here for sure, so in order of least boring and niche.*

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
