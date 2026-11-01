Proper description with pretty pictures TBD.

### Super-Power LoRA Loader:

A loRA loader built for crazy people far too many loRAs for even a single model, to effectively manage their horde of loRAs. 

*still in beta, so some things may change, but it should be just how functions are displayed rather than any fictionality additions or changes, feel free to throw in your 2 cents.* 

**All Modes and Compactions of the Same Node:**

<img src="Img/Super-PowerLoRALoader_modes-and-compactions.png" width="600">.

every mode switch is 1 click, 2 clicks for one which will ask if you want it to be the default behaviour with a check box, then it gets out of your way and is 1 click.

Setup Wizard: automatically finds all `ComfyUI/model/loras` locations—for those particularly masochistic individuals among us, that have multiple insistences of ComfyUI and keep different loras for the same model in different installations and refuse to have a centralised location for their models—and allows you to select all Folder trees and individual loras you want on dropping the node on the canvas.

**Narrow Mode:** 
Just drag the node narrow enough and it will automatically compact everything that needs compacting, everything is still accessible by hovering over the vertical "..." icon and in the case of model strength hover over the compact model strength.

<img src="Img/Compact_Loader_W-STR_L-INFO_Trig_Star-L.jpg" width="300">. <img src="Img/Compact_Loader_W-SRT.jpg" width="300">.

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
For organising a Notes and Markdown Notes into a centralised location, all data kept within the workflow, also add a tag list loosely based on a mix between Markdown Note and the chip system from the model info from rgthree Power Lora Loader.



### Nodes 2.0 front-end patch for rgthree-comfy:
<img src="Img/rgthree_comfy_2.0_nodes.jpg" width="400">.

Why I have bothered? 

I noticed a generation speed increase with nodes 2.0 when you are having to block swap a lot with nodes 2.0 vs classic canvas and you get a lot less hitches in both the UI and the model it's self when dragging the canvas, like with a video model on a 16GB card when pushing resolution and length to the limits. Admittedly you do get a lower canvas FPS, but hitches are much worse than low FPS, and generation speed is even more important, if you have plenty of VRAM pleas ignore, *jealousy intensifying.* Think it has something to do with how the classic canvas redraws everything as you drag the canvas. At any rate it only took a couple of hours and about 10-15% of my weekly Claude usage allowance, so meh.

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
