For the moment 4 nodes which consist of 

Force Changed Node:
A node that has a model text and seed input, assuming you are using positive and negative conditioning use a Text Concatenate node to concatenate the text into a single string 
and wire it into the Force Changed (seed + text) node, wire in you seed and wire the model into the Force Changed (seed + text) before a stateful node, it will change and therefore 
will force the stateful node to recalculate.

Sigmas At Percent:
Does what it says on the tin, takes the sigmas from your scheduler and allows you to pick the sigmas value at a from 0.000 to 1.000 complete, useful for things like 
"Perturbed-Attention Guidance (Advanced)" which need you to input the sigmas values rather than steps or a linear 0 to 1 more useful for older models admittedly as more modern
models use sigmas of 0 to 1 anyway, but it's not linear and is a curve, so if you want to end or start at a specific point it's just more intuitive.

Sigmas at Step: 
Same as sigmas at percent, but at a step instead of a percent complete, probably more useful and intuitive too.

Resolution Picker: 
A resolution selector with a live preview of the output resolution, select the: 
megapixels 
aspect ratio
orientation "done so you don't have to have 2 fields in the aspect ratio halving the list size", divisible_by "what the height and width must be divisible by"

Pretty basic nodes which require no updates, just "git clone" the repo using cmd.
