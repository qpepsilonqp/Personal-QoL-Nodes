Proper description with pretty pictures TBD.

### Super-Power LoRA Loader:

A loRA loader built for crazy people far too many loRAs for even a single model, to effectively manage their horde of loRAs. 

*still in beta, so some things may change, but it should be just how functions are displayed rather than any fictionality additions or changes, feel free to throw in your 2 cents.* 

**All Modes and Compactions of the Same Node:**

<img src="Img/Super-PowerLoRALoader_modes-and-compactions.png" width="600">.

every mode switch is 1 click, 2 clicks for one which will ask if you want it to be the default behaviour with a check box, then it gets out of your way and is 1 click.

Setup Wizard: automatically finds all `ComfyUI/model/loras` locations and allows you to select all Folder trees and individual loras you want on dropping the node on the canvas.

**Narrow Mode:** 

which you get by dragging the node narrow enough, everything is still accessible by hovering over the vertical "..." icon.

<img src="Img/Compact_Loader_W-STR_L-INFO_Trig_Star-L.jpg" width="300">.

<img src="Img/Compact_Loader_W-SRT.jpg" width="300">.

in case of model strength hover over the compact model strength.

**Plain List mode:** 

while collapsing enabled can make it like the rgthree's Power Lora Loader, but with search, bookmarks, favourites, mixes and being able to move in whole folder trees of loras if you so choose, also limits you to 20 rows before enabling scrolling.

<img src="Img/Loader_Plane-List.jpg" width="300">.

being real, you should just be using the narrow mode, maybe with groups collapsed, and just rely on search to find your loRAs, unless you have a small number of loRAs probably 10 or less. if you have more but want specific set of loras, just add all the loras for the model and use Mixes that’s exactly what that is for.

**Quick Menu, Favourites, History:**

<img src="Img/LL_Quick-Menu.png" width="300">.

Does what it says on the tin, quickly access Favourites, History and Mixes and make some changes to them. 

**Mixes:** 

probably the only thing I need to explain, a Mix here is a collection of loRAs you have added to the node, they get their own strength so you can load them in the way you have dialled them in to do what you want, in enabled or in list mode you can still enable loras that are in the Mix, doing this will grey out the lora in the mix and will not change the mixes strength, instead you will get the regular strength you have set for the lora, or default 1.00 if you have not entered a strength.



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

### Nodes 2.0 front-end patch for rgthree-comfy.

<img src="Img/rgthree_comfy_2.0_nodes.jpg" width="400">.

Why bother with nodes 2.0, is it because I am simply blown away with the aesthetic... no. 

Cutting a long story short. When dealing with a lot of block swapping—like when running a video model—with a relative to the model size low VRAM card, when you consider the size of the attention layers ontop of the model: I have found in my experience that nodes 2.0 can actually offer a generation speed advantage and will have far less lags. It will be lower FPS than the classic canvas on average, but hitches are so much more annoying than low FPS for a UI. probably has something to do with nodes 2.0 drawing everything and then only redrawing what changes rather than redrawing everything if you move the canvas.

-  Added a gear icon for settings to nodes where it made sense.
-  added multiple choice to setting where it made sense, rather than having to type out things where there were limited choices.
-  each node is togglable in ComfyUI settings encase the fix breaks.

Gear icon was added because properties is a blocked term for Nodes 2.0, did also add a Node Properties to the right click menu, but it gets berried half way down the right click menu, so using the dead space next to the source badge was an easy choice.

PS: This is only a front-end patch only, you must install [rgthree-comfy](https://github.com/rgthree/rgthree-comfy) separately if you want it, if you want the patch only it should be possible to take the `__init__.py` and `web/rgthree_nodes2_fix/...` and putting it in a folder in your custom nodes. designed so that if the patch breaks it wont break classic canvas, but s£$% happens so.

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
